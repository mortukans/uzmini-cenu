// Service-role Supabase client + caller authorization for internal functions.
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-injected by the Edge runtime.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

export function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * Internal functions (send-push, build-daily, sweep) are only ever called by
 * pg_net / pg_cron / CI with the service role key as Bearer. Anything else is 401.
 * A separate INTERNAL_SECRET may be used instead so the service key never has to
 * live in a database setting.
 */
export function assertInternalCaller(req: Request): Response | null {
  const auth = req.headers.get('authorization') ?? '';
  const bearer = auth.replace(/^Bearer\s+/i, '').trim();
  const ok = [Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), Deno.env.get('INTERNAL_SECRET')]
    .filter((s): s is string => !!s)
    .some((s) => s === bearer);
  if (!ok) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }
  return null;
}
