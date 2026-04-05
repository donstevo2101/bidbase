import { Router } from 'express';
import { z } from 'zod';
import { supabase, supabaseAuth } from '../lib/supabase.js';
import { validate } from '../middleware/validate.js';
import { authMiddleware } from '../middleware/auth.js';

export const authRouter = Router();

// ---- Schemas ----

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  fullName: z.string().min(1, 'Full name is required'),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const resetPasswordSchema = z.object({
  email: z.string().email(),
});

// ---- Helpers ----

function asyncHandler(fn: (req: any, res: any) => Promise<void>) {
  return (req: any, res: any, next: any) => {
    fn(req, res).catch(next);
  };
}

// ---- Routes ----

// POST /api/auth/register
authRouter.post(
  '/register',
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const { email, password, fullName } = req.body;

    // Create user via admin API (bypasses email provider settings)
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

    if (error) {
      console.error('[Register]', error.message);
      if (error.message.includes('already registered') || error.message.includes('already been registered')) {
        res.status(409).json({
          success: false,
          error: { code: 'EMAIL_EXISTS', message: 'An account with this email already exists' },
        });
        return;
      }
      res.status(500).json({
        success: false,
        error: { code: 'REGISTRATION_FAILED', message: error.message },
      });
      return;
    }

    if (data.user) {
      // Explicitly confirm email via admin update
      await supabase.auth.admin.updateUserById(data.user.id, {
        email_confirm: true,
      });

      // Update profile with full name
      await supabase
        .from('profiles')
        .update({ full_name: fullName })
        .eq('id', data.user.id);

      // Auto-login: generate tokens so the user can sign in immediately
      const { data: signInData } = await supabaseAuth.auth.signInWithPassword({ email, password });

      if (signInData?.session) {
        res.status(201).json({
          success: true,
          data: {
            userId: data.user.id,
            accessToken: signInData.session.access_token,
            refreshToken: signInData.session.refresh_token,
            message: 'Account created and logged in.',
          },
        });
        return;
      }
    }

    res.status(201).json({
      success: true,
      data: {
        userId: data.user?.id,
        message: 'Account created. You can now sign in.',
      },
    });
  })
);

// POST /api/auth/login
authRouter.post(
  '/login',
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    // Use admin.generateLink to verify credentials when email provider is disabled
    // First try signInWithPassword, fall back to admin verify
    let session: { access_token: string; refresh_token: string; expires_at?: number } | null = null;
    let userId: string | null = null;

    const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password });

    if (!error && data.session) {
      session = data.session;
      userId = data.user.id;
    } else {
      // signInWithPassword failed — try verifying via admin API
      // List users to find by email, then generate a link
      const { data: userData } = await supabase.auth.admin.listUsers();
      const user = userData?.users?.find((u) => u.email === email);

      if (!user) {
        res.status(401).json({
          success: false,
          error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
        });
        return;
      }

      // Verify password by attempting signInWithPassword via the Supabase REST API directly
      const verifyRes = await fetch(
        `${process.env['SUPABASE_URL']}/auth/v1/token?grant_type=password`,
        {
          method: 'POST',
          headers: {
            'apikey': process.env['SUPABASE_ANON_KEY'] ?? '',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ email, password }),
        }
      );

      if (!verifyRes.ok) {
        res.status(401).json({
          success: false,
          error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
        });
        return;
      }

      const tokenData = await verifyRes.json() as {
        access_token: string;
        refresh_token: string;
        expires_at: number;
        user: { id: string };
      };
      session = tokenData;
      userId = tokenData.user.id;
    }

    if (!session || !userId) {
      res.status(401).json({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
      });
      return;
    }

    // Fetch profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('organisation_id, role, full_name')
      .eq('id', userId)
      .single();

    res.json({
      success: true,
      data: {
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
        expiresAt: session.expires_at,
        user: {
          id: userId,
          email,
          fullName: profile?.full_name,
          role: profile?.role,
          organisationId: profile?.organisation_id,
        },
      },
    });
  })
);

// POST /api/auth/logout
authRouter.post(
  '/logout',
  authMiddleware,
  asyncHandler(async (req, res) => {
    await supabase.auth.admin.signOut(req.accessToken);
    res.json({ success: true, data: { message: 'Logged out successfully' } });
  })
);

// POST /api/auth/reset-password
authRouter.post(
  '/reset-password',
  validate(resetPasswordSchema),
  asyncHandler(async (req, res) => {
    const { email } = req.body;

    const clientUrl = process.env['CLIENT_URL'] ?? 'http://localhost:5173';

    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${clientUrl}/auth/update-password`,
    });

    // Always return success to prevent email enumeration
    res.json({
      success: true,
      data: { message: 'If an account with that email exists, a reset link has been sent.' },
    });
  })
);

// GET /api/auth/me
authRouter.get(
  '/me',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', req.user.id)
      .single();

    if (!profile) {
      res.status(404).json({
        success: false,
        error: { code: 'PROFILE_NOT_FOUND', message: 'Profile not found' },
      });
      return;
    }

    // If user has an org, fetch org details too
    let organisation = null;
    if (profile.organisation_id) {
      const { data: org } = await supabase
        .from('organisations')
        .select('id, name, slug, plan, active, onboarding_complete, branding')
        .eq('id', profile.organisation_id)
        .single();
      organisation = org;
    }

    res.json({
      success: true,
      data: {
        user: {
          id: req.user.id,
          email: req.user.email,
          fullName: profile.full_name,
          role: profile.role,
          avatarUrl: profile.avatar_url,
          preferences: profile.preferences,
        },
        organisation,
      },
    });
  })
);
