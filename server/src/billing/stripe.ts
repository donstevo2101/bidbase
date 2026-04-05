import Stripe from 'stripe';
import { supabase } from '../lib/supabase.js';

// ---- Stripe client (nullable — like anthropic.ts) ----

const stripeSecretKey = process.env['STRIPE_SECRET_KEY'];

if (!stripeSecretKey) {
  console.warn('STRIPE_SECRET_KEY not set — billing features will be unavailable');
}

export const stripe = stripeSecretKey
  ? new Stripe(stripeSecretKey, { apiVersion: '2024-12-18.acacia' })
  : null;

// ---- Plan → Stripe price ID mapping ----

export const PLAN_PRICE_IDS: Record<string, string | undefined> = {
  starter: process.env['STRIPE_STARTER_PRICE_ID'],
  professional: process.env['STRIPE_PROFESSIONAL_PRICE_ID'],
};

/**
 * Get the Stripe price ID for a given plan name.
 * Returns undefined if the plan has no price ID configured (e.g. enterprise).
 */
export function getPriceIdForPlan(plan: string): string | undefined {
  return PLAN_PRICE_IDS[plan];
}

// ---- Customer helpers ----

/**
 * Get or create a Stripe customer for an organisation.
 * Looks up `stripe_customer_id` on the org row first.
 * If absent, creates a new Stripe customer and stores the ID.
 */
export async function getOrCreateStripeCustomer(
  orgId: string
): Promise<string> {
  if (!stripe) {
    throw new Error('Stripe is not configured');
  }

  // Check if org already has a Stripe customer
  const { data: org, error: orgError } = await supabase
    .from('organisations')
    .select('stripe_customer_id, name, owner_id')
    .eq('id', orgId)
    .single();

  if (orgError || !org) {
    throw new Error('Organisation not found');
  }

  if (org.stripe_customer_id) {
    return org.stripe_customer_id;
  }

  // Look up owner email for the customer record
  let email: string | undefined;
  if (org.owner_id) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', org.owner_id)
      .single();

    if (profile) {
      const { data: authUser } = await supabase.auth.admin.getUserById(profile.id);
      email = authUser?.user?.email ?? undefined;
    }
  }

  // Create Stripe customer
  const customer = await stripe.customers.create({
    name: org.name,
    email,
    metadata: {
      org_id: orgId,
    },
  });

  // Store the customer ID on the org
  await supabase
    .from('organisations')
    .update({ stripe_customer_id: customer.id })
    .eq('id', orgId);

  return customer.id;
}
