import { Router } from 'express';
import type { Request, Response } from 'express';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { startAutonomousAgents, stopAutonomousAgents, getSchedulerStatus } from '../agents/autonomousScheduler.js';
import { supabase } from '../lib/supabase.js';

export const schedulerRouter = Router();

schedulerRouter.use(authMiddleware);
schedulerRouter.use(requireRole('org_admin'));

// ---- POST /start — start the autonomous scheduler ----
schedulerRouter.post('/start', async (req: Request, res: Response) => {
  try {
    const orgId = req.user.org_id;
    const intervalMs = req.body.intervalMs ?? 30 * 60 * 1000;

    startAutonomousAgents(orgId, intervalMs);

    res.json({
      success: true,
      data: getSchedulerStatus(orgId),
    });
  } catch (err) {
    console.error('[Scheduler] Start failed:', err);
    res.status(500).json({
      success: false,
      error: { code: 'SCHEDULER_START_FAILED', message: 'Failed to start scheduler' },
    });
  }
});

// ---- POST /stop — stop the autonomous scheduler ----
schedulerRouter.post('/stop', async (req: Request, res: Response) => {
  try {
    const orgId = req.user.org_id;

    stopAutonomousAgents(orgId);

    res.json({
      success: true,
      data: getSchedulerStatus(orgId),
    });
  } catch (err) {
    console.error('[Scheduler] Stop failed:', err);
    res.status(500).json({
      success: false,
      error: { code: 'SCHEDULER_STOP_FAILED', message: 'Failed to stop scheduler' },
    });
  }
});

// ---- GET /status — get scheduler status ----
schedulerRouter.get('/status', (req: Request, res: Response) => {
  const orgId = req.user.org_id;
  res.json({
    success: true,
    data: getSchedulerStatus(orgId),
  });
});

// ---- GET /activity — last 50 autonomous actions ----
schedulerRouter.get('/activity', async (req: Request, res: Response) => {
  try {
    const orgId = req.user.org_id;

    const { data, error } = await supabase
      .from('activity_log')
      .select('id, action, details, created_at')
      .eq('organisation_id', orgId)
      .eq('actor_type', 'system')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      res.status(500).json({
        success: false,
        error: { code: 'FETCH_FAILED', message: 'Could not fetch scheduler activity' },
      });
      return;
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('[Scheduler] Activity fetch failed:', err);
    res.status(500).json({
      success: false,
      error: { code: 'ACTIVITY_FETCH_FAILED', message: 'Failed to fetch activity log' },
    });
  }
});
