import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env['SUPABASE_URL'];
const supabaseServiceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
}

// Verify we have the service role key, not the anon key
if (supabaseServiceKey.includes('"role":"anon"')) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY contains the anon key — check your .env');
}

console.log('[Supabase] Using key role:', supabaseServiceKey.includes('service_role') ? 'service_role' : 'unknown');

// Server-side client — uses service role key for full access
// IMPORTANT: persistSession must be false and autoRefreshToken false
// to prevent signInWithPassword from hijacking the client's auth context
export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
  global: {
    headers: {
      Authorization: `Bearer ${supabaseServiceKey}`,
    },
  },
});

// Separate client for auth operations (signInWithPassword etc.)
// Keeps the main client's service role context clean
export const supabaseAuth = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

// Create a client scoped to a specific user's JWT for RLS enforcement
export function createUserClient(accessToken: string) {
  return createClient(supabaseUrl!, supabaseServiceKey!, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
