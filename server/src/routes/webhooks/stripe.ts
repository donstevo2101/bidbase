import { Router } from 'express';
import { stripe } from '../../billing/stripe.js';
import { supabase } from '../../lib/supabase.js';
import type { Request, Response, NextFunction } from 'express';
import type Stripe from 'stripe';

export const stripeWebhookRouter = Router();

// ---- Helpers ----

function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

const WEBHOOK_SECRET = process.env['STRIPE_WEBHOOK_SECRET'];
const GRACE_PERIOD_DAYS = 7;

// ---- Webhook handler ----

/**
 * POST /
 * Stripe webhook handler.
 * Body must be raw (express.raw) — mounted before express.json() in index.ts.
 * Signature is verified using STRIPE_WEBHOOK_SECRET (Constraint 12).
 */
stripeWebhookRouter.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    if (!stripe) {
      res.status(503).json({
        success: false,
        error: { code: 'BILLING_UNAVAILABLE', message: 'Stripe is not configured' },
      });
      return;
    }

    if (!WEBHOOK_SECRET) {
      console.error('[Stripe Webhook] STRIPE_WEBHOOK_SECRET not set — rejecting webhook');
      res.status(500).json({
        success: false,
        error: { code: 'WEBHOOK_NOT_CONFIGURED', message: 'Webhook secret not configured' },
      });
      return;
    }

    // Verify signature (Constraint 12)
    const signature = req.headers['stripe-signature'];
    if (!signature) {
      res.status(400).json({
        success: false,
        error: { code: 'MISSING_SIGNATURE', message: 'Missing Stripe signature header' },
      });
      return;
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body as Buffer,
        signature as string,
        WEBHOOK_SECRET
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Stripe Webhook] Signature verification failed:', message);
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_SIGNATURE', message: 'Webhook signature verification failed' },
      });
      return;
    }

    // Route event to handler
    try {
      switch (event.type) {
        case 'checkout.session.completed':
          await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
          break;
        case 'invoice.paid':
          await handleInvoicePaid(event.data.object as Stripe.Invoice);
          break;
        case 'invoice.payment_failed':
          await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
          break;
        case 'customer.subscription.updated':
          await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
          break;
        case 'customer.subscription.deleted':
          await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
          break;
        default:
          console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
      }
    } catch (handlerError) {
      console.error(`[Stripe Webhook] Error handling ${event.type}:`, handlerError);
      // Return 200 to Stripe even on handler errors to prevent retries
      // for events we received but failed to process — log and investigate
    }

    // Always return 200 to acknowledge receipt
    res.status(200).json({ received: true });
  })
);

// ---- Event handlers ----

/**
 * checkout.session.completed
 * Activate subscription, update org plan.
 */
async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const orgId = session.metadata?.['org_id'];
  const plan = session.metadata?.['plan'];

  if (!orgId || !plan) {
    console.error('[Stripe Webhook] checkout.session.completed missing org_id or plan in metadata');
    return;
  }

  const subscriptionId = typeof session.subscription === 'string'
    ? session.subscription
    : session.subscription?.id;

  const customerId = typeof session.customer === 'string'
    ? session.customer
    : session.customer?.id;

  const updateData: Record<string, unknown> = {
    plan,
    plan_started_at: new Date().toISOString(),
    active: true,
    suspended: false,
    suspended_reason: null,
  };

  if (subscriptionId) {
    updateData.stripe_subscription_id = subscriptionId;
  }
  if (customerId) {
    updateData.stripe_customer_id = customerId;
  }

  const { error } = await supabase
    .from('organisations')
    .update(updateData)
    .eq('id', orgId);

  if (error) {
    console.error('[Stripe Webhook] Failed to update org after checkout:', error);
    return;
  }

  // Log activity
  await supabase.from('activity_log').insert({
    organisation_id: orgId,
    actor_type: 'system',
    action: 'subscription_activated',
    details: { plan, subscription_id: subscriptionId },
  });

  console.log(`[Stripe Webhook] Org ${orgId} activated on ${plan} plan`);
}

/**
 * invoice.paid
 * Confirm payment, clear any grace period.
 */
async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  const customerId = typeof invoice.customer === 'string'
    ? invoice.customer
    : invoice.customer?.id;

  if (!customerId) return;

  const { data: org } = await supabase
    .from('organisations')
    .select('id, suspended, suspended_reason')
    .eq('stripe_customer_id', customerId)
    .single();

  if (!org) {
    console.warn(`[Stripe Webhook] invoice.paid — no org found for customer ${customerId}`);
    return;
  }

  // If org was in grace period, reactivate
  if (org.suspended && org.suspended_reason === 'payment_failed') {
    await supabase
      .from('organisations')
      .update({
        suspended: false,
        suspended_reason: null,
      })
      .eq('id', org.id);

    await supabase.from('activity_log').insert({
      organisation_id: org.id,
      actor_type: 'system',
      action: 'payment_recovered',
      details: { invoice_id: invoice.id },
    });

    console.log(`[Stripe Webhook] Org ${org.id} payment recovered — suspension cleared`);
  }
}

/**
 * invoice.payment_failed
 * Start grace period (7 days), then downgrade to read-only.
 */
async function handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const customerId = typeof invoice.customer === 'string'
    ? invoice.customer
    : invoice.customer?.id;

  if (!customerId) return;

  const { data: org } = await supabase
    .from('organisations')
    .select('id, settings')
    .eq('stripe_customer_id', customerId)
    .single();

  if (!org) {
    console.warn(`[Stripe Webhook] invoice.payment_failed — no org found for customer ${customerId}`);
    return;
  }

  // Check if already in grace period
  const settings = (org.settings ?? {}) as Record<string, unknown>;
  const existingGraceStart = settings['payment_grace_start'] as string | undefined;

  if (existingGraceStart) {
    // Check if grace period has expired
    const graceStart = new Date(existingGraceStart);
    const graceEnd = new Date(graceStart.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);

    if (new Date() > graceEnd) {
      // Grace period expired — suspend the org (read-only)
      await supabase
        .from('organisations')
        .update({
          suspended: true,
          suspended_reason: 'payment_failed',
        })
        .eq('id', org.id);

      await supabase.from('activity_log').insert({
        organisation_id: org.id,
        actor_type: 'system',
        action: 'org_suspended_payment_failure',
        details: {
          invoice_id: invoice.id,
          grace_started: existingGraceStart,
          grace_expired: graceEnd.toISOString(),
        },
      });

      console.log(`[Stripe Webhook] Org ${org.id} suspended — grace period expired`);
      return;
    }
  } else {
    // Start grace period
    const updatedSettings = {
      ...settings,
      payment_grace_start: new Date().toISOString(),
    };

    await supabase
      .from('organisations')
      .update({ settings: updatedSettings })
      .eq('id', org.id);

    await supabase.from('activity_log').insert({
      organisation_id: org.id,
      actor_type: 'system',
      action: 'payment_grace_period_started',
      details: {
        invoice_id: invoice.id,
        grace_days: GRACE_PERIOD_DAYS,
      },
    });

    console.log(`[Stripe Webhook] Org ${org.id} payment failed — ${GRACE_PERIOD_DAYS}-day grace period started`);
  }
}

/**
 * customer.subscription.updated
 * Handle plan changes (upgrade/downgrade).
 */
async function handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
  const orgId = subscription.metadata?.['org_id'];

  if (!orgId) {
    // Try to find org by customer ID
    const customerId = typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer?.id;

    if (!customerId) return;

    const { data: org } = await supabase
      .from('organisations')
      .select('id')
      .eq('stripe_customer_id', customerId)
      .single();

    if (!org) return;

    await updateOrgFromSubscription(org.id, subscription);
    return;
  }

  await updateOrgFromSubscription(orgId, subscription);
}

/**
 * customer.subscription.deleted
 * Downgrade to read-only / free state.
 */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  const customerId = typeof subscription.customer === 'string'
    ? subscription.customer
    : subscription.customer?.id;

  if (!customerId) return;

  const { data: org } = await supabase
    .from('organisations')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .single();

  if (!org) {
    console.warn(`[Stripe Webhook] subscription.deleted — no org found for customer ${customerId}`);
    return;
  }

  // Downgrade to suspended / read-only state
  await supabase
    .from('organisations')
    .update({
      stripe_subscription_id: null,
      suspended: true,
      suspended_reason: 'subscription_cancelled',
    })
    .eq('id', org.id);

  await supabase.from('activity_log').insert({
    organisation_id: org.id,
    actor_type: 'system',
    action: 'subscription_cancelled',
    details: { subscription_id: subscription.id },
  });

  console.log(`[Stripe Webhook] Org ${org.id} subscription cancelled — suspended`);
}

// ---- Shared helpers ----

async function updateOrgFromSubscription(
  orgId: string,
  subscription: Stripe.Subscription
): Promise<void> {
  // Determine plan from subscription metadata or price lookup
  const plan = subscription.metadata?.['plan'];

  const updateData: Record<string, unknown> = {
    stripe_subscription_id: subscription.id,
  };

  if (plan) {
    updateData.plan = plan;
  }

  // Handle subscription status
  if (subscription.status === 'active' || subscription.status === 'trialing') {
    updateData.active = true;
    updateData.suspended = false;
    updateData.suspended_reason = null;
  } else if (subscription.status === 'past_due') {
    // Keep active but flag — grace period handling is in invoice.payment_failed
  } else if (subscription.status === 'canceled' || subscription.status === 'unpaid') {
    updateData.suspended = true;
    updateData.suspended_reason = `subscription_${subscription.status}`;
  }

  await supabase
    .from('organisations')
    .update(updateData)
    .eq('id', orgId);

  await supabase.from('activity_log').insert({
    organisation_id: orgId,
    actor_type: 'system',
    action: 'subscription_updated',
    details: {
      subscription_id: subscription.id,
      status: subscription.status,
      plan,
    },
  });
}
