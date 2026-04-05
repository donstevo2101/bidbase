import PDFDocument from 'pdfkit';
import { supabase } from '../lib/supabase.js';

// ---- Colour palette ----
const TEAL = '#0d9488';
const TEAL_LIGHT = '#ccfbf1';
const GREY_LIGHT = '#f3f4f6';
const WHITE = '#ffffff';
const TEXT_DARK = '#111827';
const TEXT_MUTED = '#6b7280';

// ---- Types ----

interface AgentActivityRow {
  agent_type: string;
  conversations: number;
  messages: number;
}

interface TaskStatusRow {
  status: string;
  count: number;
}

interface ActivityLogEntry {
  action: string;
  details: string | null;
  created_at: string;
  actor_type: string;
}

interface ClientStageRow {
  stage: string;
  count: number;
}

interface UpcomingDeadline {
  client_name: string;
  funder_name: string;
  deadline: string;
  status: string;
}

interface AlertItem {
  type: 'failed_task' | 'escalation' | 'overdue_invoice';
  description: string;
  created_at: string;
}

export interface DailyReportData {
  orgName: string;
  reportDate: string;
  agentActivity: AgentActivityRow[];
  taskSummary: TaskStatusRow[];
  clientActivity: ActivityLogEntry[];
  pipelineSnapshot: {
    stages: ClientStageRow[];
    activeApplications: number;
    totalPipelineValue: number;
  };
  upcomingDeadlines: UpcomingDeadline[];
  alerts: AlertItem[];
}

// ---- Data fetching ----

export async function fetchDailyReportData(orgId: string): Promise<DailyReportData> {
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const reportDate = now.toISOString().slice(0, 10);

  // Fetch org name
  const { data: org } = await supabase
    .from('organisations')
    .select('name')
    .eq('id', orgId)
    .single();

  // Agent activity — conversations in last 24h grouped by agent_type
  const { data: conversations } = await supabase
    .from('agent_conversations')
    .select('agent_type, id, message_count')
    .eq('organisation_id', orgId)
    .gte('created_at', twentyFourHoursAgo);

  const agentMap = new Map<string, { conversations: number; messages: number }>();
  for (const c of conversations ?? []) {
    const entry = agentMap.get(c.agent_type) ?? { conversations: 0, messages: 0 };
    entry.conversations += 1;
    entry.messages += (c.message_count ?? 0);
    agentMap.set(c.agent_type, entry);
  }
  const agentActivity: AgentActivityRow[] = Array.from(agentMap.entries()).map(
    ([agent_type, v]) => ({ agent_type, ...v })
  );

  // Task summary — tasks in last 24h grouped by status
  const { data: tasks } = await supabase
    .from('agent_tasks')
    .select('status')
    .eq('organisation_id', orgId)
    .gte('created_at', twentyFourHoursAgo);

  const statusMap = new Map<string, number>();
  for (const t of tasks ?? []) {
    statusMap.set(t.status, (statusMap.get(t.status) ?? 0) + 1);
  }
  const taskSummary: TaskStatusRow[] = Array.from(statusMap.entries()).map(
    ([status, count]) => ({ status, count })
  );

  // Client activity — recent activity log entries
  const { data: activityRows } = await supabase
    .from('activity_log')
    .select('action, details, created_at, actor_type')
    .eq('organisation_id', orgId)
    .gte('created_at', twentyFourHoursAgo)
    .order('created_at', { ascending: false })
    .limit(20);

  const clientActivity: ActivityLogEntry[] = (activityRows ?? []).map((r: any) => ({
    action: r.action,
    details: typeof r.details === 'object' ? JSON.stringify(r.details) : r.details,
    created_at: r.created_at,
    actor_type: r.actor_type,
  }));

  // Pipeline snapshot — clients grouped by stage
  const { data: clients } = await supabase
    .from('clients')
    .select('stage, pipeline_value')
    .eq('organisation_id', orgId);

  const stageMap = new Map<string, number>();
  let totalPipelineValue = 0;
  for (const c of clients ?? []) {
    stageMap.set(c.stage ?? 'unknown', (stageMap.get(c.stage ?? 'unknown') ?? 0) + 1);
    totalPipelineValue += Number(c.pipeline_value ?? 0);
  }
  const stages: ClientStageRow[] = Array.from(stageMap.entries()).map(
    ([stage, count]) => ({ stage, count })
  );

  // Active applications count
  const { count: activeApplications } = await supabase
    .from('applications')
    .select('id', { count: 'exact', head: true })
    .eq('organisation_id', orgId)
    .in('status', ['draft', 'in_progress', 'submitted', 'under_review']);

  // Upcoming deadlines — applications with deadlines in next 7 days
  const { data: deadlineRows } = await supabase
    .from('applications')
    .select('deadline, status, clients(company_name), funders(name)')
    .eq('organisation_id', orgId)
    .gte('deadline', reportDate)
    .lte('deadline', sevenDaysFromNow)
    .order('deadline', { ascending: true })
    .limit(15);

  const upcomingDeadlines: UpcomingDeadline[] = (deadlineRows ?? []).map((r: any) => ({
    client_name: r.clients?.company_name ?? 'Unknown',
    funder_name: r.funders?.name ?? 'Unknown',
    deadline: r.deadline,
    status: r.status,
  }));

  // Alerts — failed tasks, escalations, overdue invoices
  const alerts: AlertItem[] = [];

  const { data: failedTasks } = await supabase
    .from('agent_tasks')
    .select('title, created_at')
    .eq('organisation_id', orgId)
    .eq('status', 'failed')
    .gte('created_at', twentyFourHoursAgo);

  for (const t of failedTasks ?? []) {
    alerts.push({ type: 'failed_task', description: t.title ?? 'Untitled task', created_at: t.created_at });
  }

  const { data: escalated } = await supabase
    .from('agent_tasks')
    .select('title, created_at')
    .eq('organisation_id', orgId)
    .eq('status', 'escalated')
    .gte('created_at', twentyFourHoursAgo);

  for (const t of escalated ?? []) {
    alerts.push({ type: 'escalation', description: t.title ?? 'Untitled task', created_at: t.created_at });
  }

  const { data: overdueInvoices } = await supabase
    .from('invoices')
    .select('invoice_number, due_date, total')
    .eq('organisation_id', orgId)
    .eq('status', 'overdue');

  for (const inv of overdueInvoices ?? []) {
    alerts.push({
      type: 'overdue_invoice',
      description: `Invoice ${inv.invoice_number ?? 'N/A'} — £${Number(inv.total ?? 0).toFixed(2)} due ${inv.due_date}`,
      created_at: inv.due_date,
    });
  }

  return {
    orgName: org?.name ?? 'Unknown Organisation',
    reportDate,
    agentActivity,
    taskSummary,
    clientActivity,
    pipelineSnapshot: {
      stages,
      activeApplications: activeApplications ?? 0,
      totalPipelineValue,
    },
    upcomingDeadlines,
    alerts,
  };
}

// ---- PDF generation ----

function drawHeaderBar(doc: PDFKit.PDFDocument, text: string, y: number): number {
  doc
    .save()
    .rect(40, y, doc.page.width - 80, 28)
    .fill(TEAL);

  doc.fontSize(13).font('Helvetica-Bold').fillColor(WHITE).text(text, 50, y + 7, { width: doc.page.width - 100 });
  doc.restore();
  return y + 38;
}

function drawTableRow(
  doc: PDFKit.PDFDocument,
  cols: { text: string; width: number; align?: 'left' | 'right' | 'center' }[],
  y: number,
  isHeader: boolean,
  isAlternate: boolean
): number {
  const rowHeight = 22;

  if (isHeader) {
    doc.save().rect(40, y, doc.page.width - 80, rowHeight).fill(TEAL_LIGHT).restore();
  } else if (isAlternate) {
    doc.save().rect(40, y, doc.page.width - 80, rowHeight).fill(GREY_LIGHT).restore();
  }

  let x = 50;
  const font = isHeader ? 'Helvetica-Bold' : 'Helvetica';
  doc.font(font).fontSize(9).fillColor(TEXT_DARK);

  for (const col of cols) {
    doc.text(col.text, x, y + 6, { width: col.width - 10, align: col.align ?? 'left' });
    x += col.width;
  }

  return y + rowHeight;
}

function checkPageBreak(doc: PDFKit.PDFDocument, y: number, needed: number): number {
  if (y + needed > doc.page.height - 60) {
    doc.addPage();
    return 50;
  }
  return y;
}

export async function generateDailyReport(orgId: string): Promise<Buffer> {
  const data = await fetchDailyReportData(orgId);
  return buildPdfFromData(data);
}

export function buildPdfFromData(data: DailyReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
    const chunks: Uint8Array[] = [];

    doc.on('data', (chunk: Uint8Array) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ---- Title header ----
    doc
      .save()
      .rect(0, 0, doc.page.width, 90)
      .fill(TEAL)
      .restore();

    doc.fontSize(24).font('Helvetica-Bold').fillColor(WHITE).text('BidBase', 50, 20);
    doc.fontSize(10).font('Helvetica').fillColor(WHITE).text('Daily Operations Report', 50, 48);
    doc.fontSize(10).text(`${data.orgName}  •  ${data.reportDate}`, 50, 63);

    let y = 110;

    // ---- Agent Activity Summary ----
    y = checkPageBreak(doc, y, 80);
    y = drawHeaderBar(doc, 'Agent Activity Summary (Last 24h)', y);

    if (data.agentActivity.length === 0) {
      doc.font('Helvetica').fontSize(9).fillColor(TEXT_MUTED).text('No agent activity in the last 24 hours.', 50, y);
      y += 20;
    } else {
      const agentCols = [
        { text: 'Agent Type', width: 200 },
        { text: 'Conversations', width: 120, align: 'right' as const },
        { text: 'Messages', width: 120, align: 'right' as const },
      ];
      y = drawTableRow(doc, agentCols, y, true, false);
      data.agentActivity.forEach((row, i) => {
        y = checkPageBreak(doc, y, 22);
        y = drawTableRow(doc, [
          { text: row.agent_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), width: 200 },
          { text: String(row.conversations), width: 120, align: 'right' },
          { text: String(row.messages), width: 120, align: 'right' },
        ], y, false, i % 2 === 1);
      });
    }

    y += 12;

    // ---- Task Summary ----
    y = checkPageBreak(doc, y, 80);
    y = drawHeaderBar(doc, 'Task Summary (Last 24h)', y);

    if (data.taskSummary.length === 0) {
      doc.font('Helvetica').fontSize(9).fillColor(TEXT_MUTED).text('No tasks in the last 24 hours.', 50, y);
      y += 20;
    } else {
      const taskCols = [
        { text: 'Status', width: 200 },
        { text: 'Count', width: 120, align: 'right' as const },
      ];
      y = drawTableRow(doc, taskCols, y, true, false);
      data.taskSummary.forEach((row, i) => {
        y = checkPageBreak(doc, y, 22);
        y = drawTableRow(doc, [
          { text: row.status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), width: 200 },
          { text: String(row.count), width: 120, align: 'right' },
        ], y, false, i % 2 === 1);
      });
    }

    y += 12;

    // ---- Client Activity ----
    y = checkPageBreak(doc, y, 80);
    y = drawHeaderBar(doc, 'Recent Activity (Last 24h)', y);

    if (data.clientActivity.length === 0) {
      doc.font('Helvetica').fontSize(9).fillColor(TEXT_MUTED).text('No recent activity.', 50, y);
      y += 20;
    } else {
      const actCols = [
        { text: 'Time', width: 110 },
        { text: 'Action', width: 170 },
        { text: 'Details', width: 180 },
      ];
      y = drawTableRow(doc, actCols, y, true, false);
      data.clientActivity.forEach((row, i) => {
        y = checkPageBreak(doc, y, 22);
        const time = new Date(row.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        y = drawTableRow(doc, [
          { text: time, width: 110 },
          { text: row.action, width: 170 },
          { text: (row.details ?? '').slice(0, 50), width: 180 },
        ], y, false, i % 2 === 1);
      });
    }

    y += 12;

    // ---- Pipeline Snapshot ----
    y = checkPageBreak(doc, y, 100);
    y = drawHeaderBar(doc, 'Pipeline Snapshot', y);

    doc.font('Helvetica').fontSize(10).fillColor(TEXT_DARK);
    doc.text(`Active Applications: ${data.pipelineSnapshot.activeApplications}`, 50, y);
    y += 16;
    doc.text(`Total Pipeline Value: £${data.pipelineSnapshot.totalPipelineValue.toLocaleString('en-GB', { minimumFractionDigits: 2 })}`, 50, y);
    y += 20;

    if (data.pipelineSnapshot.stages.length > 0) {
      const pipeCols = [
        { text: 'Stage', width: 200 },
        { text: 'Clients', width: 120, align: 'right' as const },
      ];
      y = drawTableRow(doc, pipeCols, y, true, false);
      data.pipelineSnapshot.stages.forEach((row, i) => {
        y = checkPageBreak(doc, y, 22);
        y = drawTableRow(doc, [
          { text: `Stage ${row.stage}`, width: 200 },
          { text: String(row.count), width: 120, align: 'right' },
        ], y, false, i % 2 === 1);
      });
    }

    y += 12;

    // ---- Upcoming Deadlines ----
    y = checkPageBreak(doc, y, 80);
    y = drawHeaderBar(doc, 'Upcoming Deadlines (Next 7 Days)', y);

    if (data.upcomingDeadlines.length === 0) {
      doc.font('Helvetica').fontSize(9).fillColor(TEXT_MUTED).text('No upcoming deadlines.', 50, y);
      y += 20;
    } else {
      const dlCols = [
        { text: 'Deadline', width: 90 },
        { text: 'Client', width: 140 },
        { text: 'Funder', width: 140 },
        { text: 'Status', width: 90 },
      ];
      y = drawTableRow(doc, dlCols, y, true, false);
      data.upcomingDeadlines.forEach((row, i) => {
        y = checkPageBreak(doc, y, 22);
        y = drawTableRow(doc, [
          { text: row.deadline, width: 90 },
          { text: row.client_name.slice(0, 25), width: 140 },
          { text: row.funder_name.slice(0, 25), width: 140 },
          { text: row.status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), width: 90 },
        ], y, false, i % 2 === 1);
      });
    }

    y += 12;

    // ---- Alerts ----
    y = checkPageBreak(doc, y, 80);
    y = drawHeaderBar(doc, 'Alerts', y);

    if (data.alerts.length === 0) {
      doc.font('Helvetica').fontSize(9).fillColor(TEAL).text('No alerts — all clear.', 50, y);
      y += 20;
    } else {
      const alertCols = [
        { text: 'Type', width: 120 },
        { text: 'Description', width: 300 },
      ];
      y = drawTableRow(doc, alertCols, y, true, false);
      data.alerts.forEach((row, i) => {
        y = checkPageBreak(doc, y, 22);
        const label = row.type === 'failed_task' ? 'Failed Task'
          : row.type === 'escalation' ? 'Escalation'
          : 'Overdue Invoice';
        y = drawTableRow(doc, [
          { text: label, width: 120 },
          { text: row.description.slice(0, 70), width: 300 },
        ], y, false, i % 2 === 1);
      });
    }

    // ---- Footer on every page ----
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc
        .fontSize(8)
        .font('Helvetica')
        .fillColor(TEXT_MUTED)
        .text(
          `Generated by BidBase  •  Page ${i + 1} of ${pageCount}`,
          40,
          doc.page.height - 30,
          { width: doc.page.width - 80, align: 'center' }
        );
    }

    doc.end();
  });
}
