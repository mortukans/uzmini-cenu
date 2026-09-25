/**
 * sweep — thin fallback for pg_cron's `sweep-deadlines` job. Calls
 * public.run_sweep() (service role only), which runs private.sweep_deadlines():
 * closes overdue duel/room rounds, flips 24 h invites to async, expires 7 d
 * invites, finishes stale lobbies. Use it from an external scheduler (GitHub
 * Actions cron, cron-job.org) when pg_cron can not run every 10 s on the project.
 *
 * Deploy:   supabase functions deploy sweep --no-verify-jwt
 * Secrets:  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto), INTERNAL_SECRET (optional)
 * Call:     curl -X POST https://<ref>.supabase.co/functions/v1/sweep -H "Authorization: Bearer $SERVICE_ROLE_KEY"
 *           ?loop=5 runs the sweep 5 times at 10 s intervals within one invocation (max 5).
 */
import { serviceClient, assertInternalCaller } from '../_shared/client.ts';
import { json, preflight } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const denied = assertInternalCaller(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const loops = Math.min(5, Math.max(1, Number(url.searchParams.get('loop') ?? '1') || 1));
  const db = serviceClient();
  const results: number[] = [];

  for (let i = 0; i < loops; i++) {
    const { data, error } = await db.rpc('run_sweep');
    if (error) return json({ ok: false, error: error.message, results }, 500);
    results.push(Number(data ?? 0));
    if (i < loops - 1) await new Promise((r) => setTimeout(r, 10_000));
  }
  return json({ ok: true, closed: results });
});
