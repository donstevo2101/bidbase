import type { Request, Response, NextFunction } from 'express';

/**
 * Org scope middleware.
 * Ensures every query is scoped to the authenticated user's org_id.
 * org_id ALWAYS comes from the verified JWT — never from user input.
 *
 * This middleware runs after authMiddleware and makes req.user.org_id
 * available. It also rejects requests from users without an org
 * (except super_admins, who can operate cross-org).
 */
export function orgScopeMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Super admins bypass org scope — they operate cross-org
  if (req.user.role === 'super_admin') {
    next();
    return;
  }

  if (!req.user.org_id) {
    res.status(403).json({
      success: false,
      error: { code: 'NO_ORGANISATION', message: 'No organisation context' },
    });
    return;
  }

  // org_id is now guaranteed available on req.user for all downstream handlers
  next();
}
