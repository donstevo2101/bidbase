import type { Request, Response, NextFunction } from 'express';
import { supabase } from '../lib/supabase.js';
import type { UserRole } from '../../../shared/types/database.js';

// Extend Express Request with authenticated user context
declare global {
  namespace Express {
    interface Request {
      user: {
        id: string;
        email: string;
        org_id: string;
        role: UserRole;
      };
      accessToken: string;
    }
  }
}

/**
 * JWT validation middleware.
 * Verifies the Supabase access token, extracts user + org context,
 * and injects it into req.user. Every route behind this middleware
 * has guaranteed user context.
 */
export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      error: { code: 'UNAUTHENTICATED', message: 'Missing or invalid authorization header' },
    });
    return;
  }

  const token = authHeader.slice(7);

  // Verify JWT with Supabase
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    res.status(401).json({
      success: false,
      error: { code: 'UNAUTHENTICATED', message: 'Invalid or expired token' },
    });
    return;
  }

  // Fetch profile to get org_id and role
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('organisation_id, role')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) {
    res.status(401).json({
      success: false,
      error: { code: 'PROFILE_NOT_FOUND', message: 'User profile not found' },
    });
    return;
  }

  // Allow users without an org to pass auth (needed for /auth/me, /organisations create)
  // Org-scoped routes use orgScopeMiddleware to enforce org_id separately
  if (!profile.organisation_id && profile.role !== 'super_admin') {
    // Still set user context — just without org_id
  }

  req.user = {
    id: user.id,
    email: user.email ?? '',
    org_id: profile.organisation_id,
    role: profile.role as UserRole,
  };
  req.accessToken = token;

  next();
}

/**
 * Role guard — restricts a route to specific roles.
 * Use after authMiddleware.
 */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Insufficient permissions' },
      });
      return;
    }
    next();
  };
}
