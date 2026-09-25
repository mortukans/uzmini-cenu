/**
 * build-daily — builds the daily set (docs/03 "Daily set builder").
 * Deterministic: seed = sha256(day + DAILY_SEED_SECRET). Quotas: 2 flats
 * (different districts), 1 house, 1 car, 1 random. Writes a PRICE-FREE
 * snapshot into daily_sets and the prices into context_prices('daily', day).
 * Idempotent per day (existing row is left alone unless ?force=1).
 *
 * Default day = TOMORROW (Riga); pg_cron calls it at 20:00 UTC. Body/query
 * may pass {"day":"YYYY-MM-DD"} or ?today=1.
 *
 * Deploy:   supabase functions deploy build-daily --no-verify-jwt
 * Secrets:  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto)
 *           DAILY_SEED_SECRET (any long random string; changing it changes future days only)
 *           INTERNAL_SECRET (optional Bearer alternative)
 *           NOTIFY_DAILY=1  (optional: also POST {event:'daily_ready'} to send-push)
 * Local:    supabase functions serve build-daily --env-file supabase/.env
 *           curl -X POST 'localhost:54321/functions/v1/build-daily?today=1' -H "Authorization: Bearer $SERVICE_ROLE_KEY"
 */
import { serviceClient, assertInternalCaller } from '../_shared/client.ts';
import { json, preflight, rigaDate } from '../_shared/cors.ts';

interface Listing {
  id: number; category: string; region: string | null; location: string | null;
  attributes: Record<string, unknown>; title_hint: string | null; photo_urls: string[];
  source: string; source_url: string; price_eur: number; quality: number;
}

const QUOTAS = ['flats', 'flats', 'houses', 'cars', 'random'] as const;
const HIDDEN_ATTRS = ['_raw', 'trim_hint', 'dup_of', 'also_at'];

// ── seeded RNG: counter-mode sha256 over (seed || counter), first 4 bytes -> [0,1) ─
async function makeRng(seedInput: string): Promise<() => Promise<number>> {
  const enc = new TextEncoder();
  const seed = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(seedInput)));
  let counter = 0;
  return async () => {
    const buf = new Uint8Array(seed.length + 4);
    buf.set(seed, 0);
    new DataView(buf.buffer).setUint32(seed.length, counter++, false);
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
    return new DataView(h.buffer).getUint32(0, false) / 2 ** 32;
  };
}

async function weightedPick<T>(items: T[], weights: number[], rng: () => Promise<number>): Promise<T> {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = (await rng()) * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

async function shuffle<T>(arr: T[], rng: () => Promise<number>): Promise<T[]> {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor((await rng()) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx];
}

function strip(l: Listing) {
  const attributes = { ...l.attributes };
  for (const k of HIDDEN_ATTRS) delete attributes[k];
  return {
    id: l.id, category: l.category, region: l.region, location: l.location,
    attributes, title_hint: l.title_hint, photo_urls: l.photo_urls, source: l.source, source_url: l.source_url,
  };
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const denied = assertInternalCaller(req);
  if (denied) return denied;

  const url = new URL(req.url);
  let body: Record<string, unknown> = {};
  if (req.method === 'POST') { try { body = await req.json(); } catch { /* empty body from pg_net is fine */ } }

  const force = url.searchParams.get('force') === '1' || body.force === true;
  const day = typeof body.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.day)
    ? body.day
    : url.searchParams.get('today') === '1' ? rigaDate() : rigaDate(new Date(), 1);

  const db = serviceClient();
  const warnings: string[] = [];

  const { data: existing } = await db.from('daily_sets').select('day').eq('day', day).maybeSingle();
  if (existing && !force) return json({ ok: true, day, skipped: 'exists' });

  // listings used in the last 60 days are excluded
  const since = rigaDate(new Date(day + 'T12:00:00Z'), -60);
  const { data: recent } = await db.from('daily_sets').select('listing_ids').gte('day', since).neq('day', day);
  const used = new Set<number>((recent ?? []).flatMap((r: { listing_ids: number[] }) => r.listing_ids));

  const nowMs = Date.now();
  const stableBefore = new Date(nowMs - 24 * 3600_000).toISOString();
  const relaxedBefore = new Date(nowMs - 12 * 3600_000).toISOString();
  const checkedAfter = new Date(nowMs - 48 * 3600_000).toISOString();

  const rng = await makeRng(day + (Deno.env.get('DAILY_SEED_SECRET') ?? 'dev-daily-seed'));
  const chosen: Listing[] = [];

  for (const cat of QUOTAS) {
    const load = async (firstSeenBefore: string) => {
      const { data, error } = await db.from('listings')
        .select('id, category, region, location, attributes, title_hint, photo_urls, source, source_url, price_eur, quality')
        .eq('category', cat).eq('status', 'active').gte('quality', 0)
        .lt('first_seen_at', firstSeenBefore).gt('checked_at', checkedAfter)
        .limit(5000);
      if (error) throw error;
      return (data as Listing[]).filter((l) => !used.has(l.id) && !chosen.some((c) => c.id === l.id));
    };
    let pool = await load(stableBefore);
    if (pool.length < 20) {
      warnings.push(`daily_pool_thin:${cat}:${pool.length}`);
      pool = await load(relaxedBefore);
    }
    if (pool.length < 5) {
      // last resort (young pool, e.g. right after launch): anything active
      warnings.push(`daily_pool_young:${cat}:${pool.length}`);
      pool = await load(new Date(nowMs + 60_000).toISOString());
    }
    if (cat === 'flats') {
      const first = chosen.find((c) => c.category === 'flats');
      if (first) {
        const d = first.attributes?.district;
        const filtered = pool.filter((l) => l.attributes?.district !== d);
        if (filtered.length) pool = filtered;
      }
    }
    // avoid trivially easy or absurd items: keep p10..p95 of the pool
    if (pool.length >= 10) {
      const prices = pool.map((l) => l.price_eur).sort((a, b) => a - b);
      const lo = percentile(prices, 0.10), hi = percentile(prices, 0.95);
      const mid = pool.filter((l) => l.price_eur >= lo && l.price_eur <= hi);
      if (mid.length) pool = mid;
    }
    if (pool.length === 0) {
      warnings.push(`daily_pool_empty:${cat}`);
      continue;
    }
    // prefer curated: weight 1 + quality*2
    const weights = pool.map((l) => 1 + Math.max(l.quality ?? 0, 0) * 2);
    chosen.push(await weightedPick(pool, weights, rng));
  }

  if (chosen.length < 5) {
    return json({ ok: false, day, error: 'not_enough_listings', chosen: chosen.length, warnings }, 422);
  }

  const ordered = await shuffle(chosen, rng);   // category order varies per day
  const listing_ids = ordered.map((l) => l.id);
  const snapshot = ordered.map(strip);          // price-free

  const { error: e1 } = await db.from('daily_sets').upsert({ day, listing_ids, snapshot }, { onConflict: 'day' });
  if (e1) return json({ ok: false, day, error: e1.message }, 500);

  if (force) await db.from('context_prices').delete().eq('context_type', 'daily').eq('context_id', day);
  const { error: e2 } = await db.from('context_prices').upsert(
    ordered.map((l) => ({ context_type: 'daily', context_id: day, listing_id: l.id, price_eur: l.price_eur })),
    { onConflict: 'context_type,context_id,listing_id' },
  );
  if (e2) return json({ ok: false, day, error: e2.message }, 500);

  // optional: "daily_ready" push, only useful when building for today
  if (Deno.env.get('NOTIFY_DAILY') === '1' && day === rigaDate()) {
    const base = Deno.env.get('SUPABASE_URL');
    try {
      await fetch(`${base}/functions/v1/send-push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
        body: JSON.stringify({ event: 'daily_ready', payload: { day } }),
      });
    } catch (e) { warnings.push(`notify_failed:${String(e)}`); }
  }

  return json({ ok: true, day, listing_ids, categories: ordered.map((l) => l.category), warnings });
});
