import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { stripe, getOrCreateStripeCustomer, getPriceIdForPlan } from '../billing/stripe.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { orgScopeMiddleware } from '../middleware/orgScope.js';
import { validate } from '../middleware/validate.js';
import type { Request, Response, NextFunction } from 'express';

export const billingRouter = Router();

// All billing routes require auth and org scope
billingRouter.use(authMiddleware, orgScopeMiddleware);

// ---- Helpers ----

function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

const CLIENT_URL = process.env['CLIENT_URL'] ?? 'http://localhost:5173';

// ---- Schemas ----

const createCheckoutSchema = z.object({
  plan: z.enum(['starter', 'professional']),
});

// ---- Routes ----

/**
 * POST /create-checkout
 * Create a Stripe Checkout session for plan upgrade.
 * org_admin only.
 */
billingRouter.post(
  '/create-checkout',
  requireRole('org_admin'),
  validate(createCheckoutSchema),
  asyncHandler(async (req: Request, res: Response) => {
    if (!stripe) {
      res.status(503).json({
        success: false,
        error: { code: 'BILLING_UNAVAILABLE', message: 'Billing is not configured' },
      });
      return;
    }

    const { plan } = req.body as z.infer<typeof createCheckoutSchema>;
    const orgId = req.user.org_id;

    const priceId = getPriceIdForPlan(plan);
    if (!priceId) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_PLAN', message: `No Stripe price configured for plan: ${plan}` },
      });
      return;
    }

    const customerId = await getOrCreateStripeCustomer(orgId);

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${CLIENT_URL}/settings/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${CLIENT_URL}/settings/billing?checkout=cancelled`,
      metadata: {
        org_id: orgId,
        plan,
      },
      subscription_data: {
        metadata: {
          org_id: orgId,
          plan,
        },
      },
    });

    res.json({
      success: true,
      data: { checkoutUrl: session.url },
    });
  })
);

/**
 * POST /create-portal
 * Create a Stripe Customer Portal session for managing subscription.
 * org_admin only.
 */
billingRouter.post(
  '/create-portal',
  requireRole('org_admin'),
  asyncHandler(async (req: Request, res: Response) => {
    if (!stripe) {
      res.status(503).json({
        success: false,
        error: { code: 'BILLING_UNAVAILABLE', message: 'Billing is not configured' },
      });
      return;
    }

    const orgId = req.user.org_id;
    const customerId = await getOrCreateStripeCustomer(orgId);

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${CLIENT_URL}/settings/billing`,
    });

    res.json({
      success: true,
      data: { portalUrl: session.url },
    });
  })
);

/**
 * GET /subscription
 * Returns current subscription status, plan, renewal date, payment status.
 */
billingRouter.get(
  '/subscription',
  asyncHandler(async (req: Request, res: Response) => {
    const orgId = req.user.org_id;

    const { data: org, error: orgError } = await supabase
      .from('organisations')
      .select('plan, plan_started_at, trial_ends_at, stripe_subscription_id, stripe_customer_id')
      .eq('id', orgId)
      .single();

    if (orgError || !org) {
      res.status(404).json({
        success: false,
        error: { code: 'ORG_NOT_FOUND', message: 'Organisation not found' },
      });
      return;
    }

    // Base response without Stripe details
    const subscriptionData: Record<string, unknown> = {
      plan: org.plan,
      planStartedAt: org.plan_started_at,
      trialEndsAt: org.trial_ends_at,
      stripeSubscriptionId: org.stripe_subscription_id,
      status: 'active',
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      paymentStatus: null,
    };

    // Enrich with Stripe subscription details if available
    if (stripe && org.stripe_subscription_id) {
      try {
        const subscription = await stripe.subscriptions.retrieve(org.stripe_subscription_id);
        subscriptionData.status = subscription.status;
        subscriptionData.currentPeriodEnd = new Date(subscription.current_period_end * 1000).toISOString();
        subscriptionData.cancelAtPeriodEnd = subscription.cancel_at_period_end;

        // Get latest invoice payment status
        if (subscription.latest_invoice && typeof subscription.latest_invoice === 'string') {
          const invoice = await stripe.invoices.retrieve(subscription.latest_invoice);
          subscriptionData.paymentStatus = invoice.status;
        }
      } catch (stripeError) {
        // If Stripe lookup fails, return what we have from the DB
        console.error('[Billing] Failed to fetch Stripe subscription:', stripeError);
      }
    }

    res.json({
      success: true,
      data: subscriptionData,
    });
  })
);
