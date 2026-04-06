import { supabase } from '../lib/supabase.js';
import { generateDailyReport } from '../reports/dailyReport.js';
import { scrapeGrantPortals } from './grantScraper.js';

// ---- Types ----

interface SchedulerState {
  intervalHandle: ReturnType<typeof setInterval>;
  running: boolean;
  lastRun: Date | null;
  nextRun: Date | null;
  tasksProcessed: number;
  intervalMs: number;
  lastGrantScrape: Date | null;
}

export interface SchedulerStatus {
  running: boolean;
  lastRun: Date | null;
  nextRun: Date | null;
  tasksProcessed: number;
}

// ---- Active schedulers keyed by orgId ----
const schedulers = new Map<string, SchedulerState>();

// Default interval: 30 minutes
const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;

// ---- Logging helper ----

async function logAction(orgId: string, action: string, details: Record<string, unknown> = {}) {
  try {
    await supabase.from('activity_log').insert({
      organisation_id: orgId,
      actor_type: 'system',
      action,
      details,
    });
  } catch (err) {
    console.error('[Scheduler] Failed to log action:', err);
  }
}

// ---- Core tick function ----

async function tick(orgId: string) {
  const state = schedulers.get(orgId);
  if (!state || !state.running) return;

  const now = new Date();
  state.lastRun = now;
  state.nextRun = new Date(now.getTime() + state.intervalMs);

  console.log(`[Scheduler] Tick for org ${orgId} at ${now.toISOString()}`);

  try {
    // 1. Process pending tasks
    await processPendingTasks(orgId, state);

    // 2. Monday summary (Monday at 8am — check if within the current tick window)
    await checkMondaySummary(orgId);

    // 3. Deadline alerts (applications with deadlines in 3 days)
    await checkDeadlineAlerts(orgId);

    // 4. Overdue invoices
    await checkOverdueInvoices(orgId);

    // 5. Success fee window expirations
    await checkSuccessFeeWindows(orgId);

    // 6. Funder Intelligence weekly briefing on Mondays
    await checkFunderIntelligenceBriefing(orgId);

    // 7. Daily grant scrape
    await checkDailyGrantScrape(orgId);
  } catch (err) {
    console.error(`[Scheduler] Tick error for org ${orgId}:`, err);
    await logAction(orgId, 'scheduler_tick_error', { error: String(err) });
  }
}

// ---- Sub-tasks ----

async function processPendingTasks(orgId: string, state: SchedulerState) {
  const { data: pendingTasks } = await supabase
    .from('agent_tasks')
    .select('id, title, agent_type, priority')
    .eq('organisation_id', orgId)
    .eq('status', 'pending')
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(10);

  if (!pendingTasks || pendingTasks.length === 0) return;

  for (const task of pendingTasks) {
    try {
      // Mark as in_progress
      await supabase
        .from('agent_tasks')
        .update({ status: 'in_progress', started_at: new Date().toISOString() })
        .eq('id', task.id);

      // For now, log the task pickup. Actual agent execution would be delegated
      // to the relevant agent handler based on agent_type.
      await logAction(orgId, 'task_auto_started', {
        task_id: task.id,
        title: task.title,
        agent_type: task.agent_type,
      });

      state.tasksProcessed += 1;
    } catch (err) {
      console.error(`[Scheduler] Failed to process task ${task.id}:`, err);
      await supabase
        .from('agent_tasks')
        .update({ status: 'failed', error_message: String(err) })
        .eq('id', task.id);
    }
  }
}

async function checkMondaySummary(orgId: string) {
  const now = new Date();
  // Monday = 1, check if current hour is 8 and within 30 min window
  if (now.getDay() !== 1) return;
  if (now.getHours() !== 8) return;

  // Check if we already generated one today
  const today = now.toISOString().slice(0, 10);
  const { data: existing } = await supabase
    .from('activity_log')
    .select('id')
    .eq('organisation_id', orgId)
    .eq('action', 'monday_summary_generated')
    .gte('created_at', `${today}T00:00:00Z`)
    .limit(1);

  if (existing && existing.length > 0) return;

  try {
    const pdfBuffer = await generateDailyReport(orgId);

    // Store the report reference (PDF could be stored in Supabase Storage if needed)
    await logAction(orgId, 'monday_summary_generated', {
      report_date: today,
      size_bytes: pdfBuffer.length,
    });

    console.log(`[Scheduler] Monday summary generated for org ${orgId}`);
  } catch (err) {
    console.error(`[Scheduler] Monday summary failed for org ${orgId}:`, err);
    await logAction(orgId, 'monday_summary_failed', { error: String(err) });
  }
}

async function checkFunderIntelligenceBriefing(orgId: string) {
  const now = new Date();
  if (now.getDay() !== 1) return;
  if (now.getHours() !== 8) return;

  const today = now.toISOString().slice(0, 10);
  const { data: existing } = await supabase
    .from('activity_log')
    .select('id')
    .eq('organisation_id', orgId)
    .eq('action', 'funder_intelligence_briefing')
    .gte('created_at', `${today}T00:00:00Z`)
    .limit(1);

  if (existing && existing.length > 0) return;

  // Create a task for the funder intelligence agent
  await supabase.from('agent_tasks').insert({
    organisation_id: orgId,
    agent_type: 'funder_intelligence',
    title: 'Weekly Funder Intelligence Briefing',
    description: 'Autonomous weekly briefing on funder landscape changes, new opportunities, and deadline updates.',
    status: 'pending',
    priority: 5,
  });

  await logAction(orgId, 'funder_intelligence_briefing', {
    report_date: today,
    status: 'task_created',
  });
}

async function checkDeadlineAlerts(orgId: string) {
  const now = new Date();
  const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const todayStr = now.toISOString().slice(0, 10);
  const thresholdStr = threeDaysFromNow.toISOString().slice(0, 10);

  const { data: approaching } = await supabase
    .from('applications')
    .select('id, deadline, status, clients(company_name), funders(name)')
    .eq('organisation_id', orgId)
    .gte('deadline', todayStr)
    .lte('deadline', thresholdStr)
    .in('status', ['draft', 'in_progress', 'submitted', 'under_review']);

  if (!approaching || approaching.length === 0) return;

  // Check if we already alerted today
  const { data: existingAlerts } = await supabase
    .from('activity_log')
    .select('id')
    .eq('organisation_id', orgId)
    .eq('action', 'deadline_alert')
    .gte('created_at', `${todayStr}T00:00:00Z`)
    .limit(1);

  if (existingAlerts && existingAlerts.length > 0) return;

  for (const app of approaching) {
    const clientName = (app as any).clients?.company_name ?? 'Unknown';
    const funderName = (app as any).funders?.name ?? 'Unknown';

    await logAction(orgId, 'deadline_alert', {
      application_id: app.id,
      deadline: app.deadline,
      client_name: clientName,
      funder_name: funderName,
      days_remaining: Math.ceil((new Date(app.deadline).getTime() - now.getTime()) / (24 * 60 * 60 * 1000)),
    });
  }

  console.log(`[Scheduler] ${approaching.length} deadline alert(s) for org ${orgId}`);
}

async function checkOverdueInvoices(orgId: string) {
  const todayStr = new Date().toISOString().slice(0, 10);

  // Find invoices that are past due and not yet marked overdue
  const { data: overdueInvoices } = await supabase
    .from('invoices')
    .select('id, invoice_number, due_date, total, status')
    .eq('organisation_id', orgId)
    .eq('status', 'sent')
    .lt('due_date', todayStr);

  if (!overdueInvoices || overdueInvoices.length === 0) return;

  for (const inv of overdueInvoices) {
    // Mark as overdue
    await supabase
      .from('invoices')
      .update({ status: 'overdue' })
      .eq('id', inv.id);

    await logAction(orgId, 'invoice_overdue_alert', {
      invoice_id: inv.id,
      invoice_number: inv.invoice_number,
      due_date: inv.due_date,
      total: inv.total,
    });
  }

  console.log(`[Scheduler] ${overdueInvoices.length} overdue invoice(s) flagged for org ${orgId}`);
}

async function checkSuccessFeeWindows(orgId: string) {
  const todayStr = new Date().toISOString().slice(0, 10);

  // Check for applications with success_fee_deadline approaching or passed
  const { data: expiringFees } = await supabase
    .from('applications')
    .select('id, success_fee_deadline, status, clients(company_name), funders(name)')
    .eq('organisation_id', orgId)
    .not('success_fee_deadline', 'is', null)
    .lte('success_fee_deadline', todayStr)
    .in('status', ['approved', 'funded']);

  if (!expiringFees || expiringFees.length === 0) return;

  // Check if we already alerted today
  const { data: existing } = await supabase
    .from('activity_log')
    .select('id')
    .eq('organisation_id', orgId)
    .eq('action', 'success_fee_window_expiry')
    .gte('created_at', `${todayStr}T00:00:00Z`)
    .limit(1);

  if (existing && existing.length > 0) return;

  for (const app of expiringFees) {
    const clientName = (app as any).clients?.company_name ?? 'Unknown';

    await logAction(orgId, 'success_fee_window_expiry', {
      application_id: app.id,
      success_fee_deadline: app.success_fee_deadline,
      client_name: clientName,
    });
  }

  console.log(`[Scheduler] ${expiringFees.length} success fee window expiry alert(s) for org ${orgId}`);
}

async function checkDailyGrantScrape(orgId: string) {
  const state = schedulers.get(orgId);
  if (!state) return;

  // Skip if last scrape was less than 23 hours ago
  if (state.lastGrantScrape) {
    const hoursSinceLastScrape = (Date.now() - state.lastGrantScrape.getTime()) / (1000 * 60 * 60);
    if (hoursSinceLastScrape < 23) return;
  }

  // Also check activity_log to avoid duplicate scrapes across restarts
  const todayStr = new Date().toISOString().slice(0, 10);
  const { data: existingScrape } = await supabase
    .from('activity_log')
    .select('id')
    .eq('organisation_id', orgId)
    .eq('action', 'daily_grant_scrape')
    .gte('created_at', `${todayStr}T00:00:00Z`)
    .limit(1);

  if (existingScrape && existingScrape.length > 0) {
    // Already scraped today — update state so we don't keep checking
    state.lastGrantScrape = new Date();
    return;
  }

  try {
    console.log(`[Scheduler] Starting daily grant scrape for org ${orgId}`);
    const opportunities = await scrapeGrantPortals();

    // Upsert grants into database (same logic as the endpoint)
    let newGrants = 0;
    let updatedGrants = 0;

    for (const opp of opportunities) {
      const row = {
        title: opp.title,
        funder: opp.funder,
        url: opp.url,
        amount: opp.amount ?? null,
        deadline: opp.deadline ?? null,
        eligibility: opp.eligibility ?? null,
        description: opp.description ?? null,
        source: opp.source,
        scraped_at: opp.scrapedAt,
        open_date: opp.openDate ?? null,
        close_date: opp.closeDate ?? null,
        status: opp.status ?? 'open',
        previous_awards: opp.previousAwards ?? null,
        total_applicants: opp.totalApplicants ?? null,
        average_award: opp.averageAward ?? null,
        sectors: opp.sectors ?? null,
      };

      const { data: existing } = await supabase
        .from('grant_opportunities')
        .select('id, deadline, status, amount, description')
        .ilike('title', opp.title)
        .ilike('funder', opp.funder)
        .limit(1);

      if (existing && existing.length > 0) {
        const ex = existing[0];
        const changes: Record<string, unknown> = {};

        if (row.deadline !== ex.deadline) changes['deadline'] = row.deadline;
        if (row.close_date !== null) changes['close_date'] = row.close_date;
        if (row.open_date !== null) changes['open_date'] = row.open_date;
        if (row.status !== ex.status) changes['status'] = row.status;
        if (row.amount !== ex.amount) changes['amount'] = row.amount;
        if (row.description && row.description !== ex.description) changes['description'] = row.description;
        changes['scraped_at'] = row.scraped_at;
        changes['url'] = row.url;

        if (Object.keys(changes).length > 1) {
          await supabase.from('grant_opportunities').update(changes).eq('id', ex.id);
          updatedGrants++;
        }
      } else {
        const { error } = await supabase.from('grant_opportunities').insert(row);
        if (!error) newGrants++;
      }
    }

    // Mark expired grants as closed
    await supabase
      .from('grant_opportunities')
      .update({ status: 'closed' })
      .lt('close_date', todayStr)
      .neq('status', 'closed');

    state.lastGrantScrape = new Date();

    await logAction(orgId, 'daily_grant_scrape', {
      totalFound: opportunities.length,
      newGrants,
      updatedGrants,
      timestamp: new Date().toISOString(),
    });

    console.log(`[Scheduler] Daily grant scrape complete for org ${orgId}: ${newGrants} new, ${updatedGrants} updated`);
  } catch (err) {
    console.error(`[Scheduler] Daily grant scrape failed for org ${orgId}:`, err);
    await logAction(orgId, 'daily_grant_scrape_failed', { error: String(err) });
  }
}

// ---- Public API ----

export function startAutonomousAgents(orgId: string, intervalMs: number = DEFAULT_INTERVAL_MS) {
  // Stop existing scheduler if running
  stopAutonomousAgents(orgId);

  const state: SchedulerState = {
    intervalHandle: setInterval(() => tick(orgId), intervalMs),
    running: true,
    lastRun: null,
    nextRun: new Date(Date.now() + intervalMs),
    tasksProcessed: 0,
    intervalMs,
    lastGrantScrape: null,
  };

  schedulers.set(orgId, state);

  // Run first tick immediately
  tick(orgId);

  console.log(`[Scheduler] Started for org ${orgId} (interval: ${intervalMs / 1000}s)`);
}

export function stopAutonomousAgents(orgId: string) {
  const state = schedulers.get(orgId);
  if (!state) return;

  clearInterval(state.intervalHandle);
  state.running = false;
  state.nextRun = null;
  schedulers.delete(orgId);

  console.log(`[Scheduler] Stopped for org ${orgId}`);
}

export function getSchedulerStatus(orgId: string): SchedulerStatus {
  const state = schedulers.get(orgId);
  if (!state) {
    return { running: false, lastRun: null, nextRun: null, tasksProcessed: 0 };
  }
  return {
    running: state.running,
    lastRun: state.lastRun,
    nextRun: state.nextRun,
    tasksProcessed: state.tasksProcessed,
  };
}
