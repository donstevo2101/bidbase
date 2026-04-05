import { Router } from 'express';
import type { Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { generateDailyReport, fetchDailyReportData } from '../reports/dailyReport.js';
import { supabase } from '../lib/supabase.js';

export const reportsRouter = Router();

reportsRouter.use(authMiddleware);

// ---- GET /daily — generate and download the daily PDF report ----
reportsRouter.get('/daily', async (req: Request, res: Response) => {
  try {
    const orgId = req.user.org_id;
    const pdfBuffer = await generateDailyReport(orgId);
    const today = new Date().toISOString().slice(0, 10);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="bidbase-daily-report-${today}.pdf"`,
      'Content-Length': String(pdfBuffer.length),
    });
    res.send(pdfBuffer);
  } catch (err) {
    console.error('[Reports] Daily PDF generation failed:', err);
    res.status(500).json({
      success: false,
      error: { code: 'REPORT_GENERATION_FAILED', message: 'Failed to generate daily report' },
    });
  }
});

// ---- GET /daily/preview — return report data as JSON ----
reportsRouter.get('/daily/preview', async (req: Request, res: Response) => {
  try {
    const orgId = req.user.org_id;
    const data = await fetchDailyReportData(orgId);
    res.json({ success: true, data });
  } catch (err) {
    console.error('[Reports] Daily preview failed:', err);
    res.status(500).json({
      success: false,
      error: { code: 'REPORT_PREVIEW_FAILED', message: 'Failed to fetch report data' },
    });
  }
});

// ---- POST /daily/schedule — set daily report schedule ----
reportsRouter.post('/daily/schedule', async (req: Request, res: Response) => {
  try {
    const orgId = req.user.org_id;
    const { time, enabled } = req.body;

    if (typeof time !== 'string' || !/^\d{2}:\d{2}$/.test(time)) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_TIME', message: 'Time must be in HH:MM format' },
      });
      return;
    }

    if (typeof enabled !== 'boolean') {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_ENABLED', message: 'enabled must be a boolean' },
      });
      return;
    }

    // Read current settings
    const { data: org, error: fetchError } = await supabase
      .from('organisations')
      .select('settings')
      .eq('id', orgId)
      .single();

    if (fetchError) {
      res.status(500).json({ success: false, error: { code: 'FETCH_FAILED', message: 'Could not read organisation settings' } });
      return;
    }

    const settings = (org?.settings as Record<string, unknown>) ?? {};
    settings.daily_report_schedule = { time, enabled, updated_at: new Date().toISOString() };

    const { error: updateError } = await supabase
      .from('organisations')
      .update({ settings })
      .eq('id', orgId);

    if (updateError) {
      res.status(500).json({ success: false, error: { code: 'UPDATE_FAILED', message: 'Could not update schedule' } });
      return;
    }

    res.json({ success: true, data: { time, enabled } });
  } catch (err) {
    console.error('[Reports] Schedule update failed:', err);
    res.status(500).json({
      success: false,
      error: { code: 'SCHEDULE_UPDATE_FAILED', message: 'Failed to update schedule' },
    });
  }
});

// ---- GET /daily/schedule — get current schedule settings ----
reportsRouter.get('/daily/schedule', async (req: Request, res: Response) => {
  try {
    const orgId = req.user.org_id;

    const { data: org, error } = await supabase
      .from('organisations')
      .select('settings')
      .eq('id', orgId)
      .single();

    if (error) {
      res.status(500).json({ success: false, error: { code: 'FETCH_FAILED', message: 'Could not read organisation settings' } });
      return;
    }

    const settings = (org?.settings as Record<string, unknown>) ?? {};
    const schedule = (settings.daily_report_schedule as Record<string, unknown>) ?? { time: '08:00', enabled: false };

    res.json({ success: true, data: schedule });
  } catch (err) {
    console.error('[Reports] Schedule fetch failed:', err);
    res.status(500).json({
      success: false,
      error: { code: 'SCHEDULE_FETCH_FAILED', message: 'Failed to fetch schedule' },
    });
  }
});
