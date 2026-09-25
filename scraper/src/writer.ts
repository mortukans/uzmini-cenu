/**
 * The only module that writes to Supabase. Column names follow docs/05
 * (`listings`) and docs/03 (`scrape_runs`) exactly. Uses the service-role key;
 * never ship this module to the client.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './config.ts';
import type { ExistingRow } from './deduper.ts';
import { photoFingerprint } from './deduper.ts';
import type { ParsedListing, RejectCode, ScrapeRunRow, SsCategory } from './types.ts';

export interface ListingRow {
  source: string;
  source_url: string;
  category: SsCategory;
  price_eur: number;
  region: string | null;
  location: string | null;
  attributes: Record<string, unknown>;
  title_hint: string | null;
  photo_urls: string[];
  photo_hash: string | null;
  status: 'active' | 'expired' | 'rejected';
  checked_at: string;
  first_seen_at?: string;
}

export interface Writer {
  upsertActive(listings: ParsedListing[]): Promise<{ inserted: number; updated: number }>;
  writeRejected(listing: ParsedListing, code: RejectCode, dupOf?: number): Promise<void>;
  knownUrls(urls: string[]): Promise<Set<string>>;
  activeCandidates(category: SsCategory): Promise<ExistingRow[]>;
  touch(urls: string[]): Promise<void>;
  expire(urls: string[]): Promise<number>;
  dueForRecheck(limit: number, olderThanDays: number): Promise<{ source_url: string; category: SsCategory }[]>;
  dailyCandidates(limit: number): Promise<{ source_url: string; category: SsCategory }[]>;
  startRun(source: string, notes?: string): Promise<number>;
  finishRun(id: number, stats: Partial<ScrapeRunRow>): Promise<void>;
  lastBlockedUntil(source: string): Promise<string | null>;
  runStats(limit: number): Promise<ScrapeRunRow[]>;
  poolStats(): Promise<Record<string, Record<string, number>>>;
}

export function toRow(l: ParsedListing, now = new Date()): ListingRow {
  if (l.price_eur === null) throw new Error('toRow: price_eur is null; run quality first');
  return {
    source: l.source,
    source_url: l.source_url,
    category: l.category,
    price_eur: l.price_eur,
    region: l.region,
    location: l.location,
    attributes: l.attributes as Record<string, unknown>,
    title_hint: l.title_hint,
    photo_urls: l.photo_urls,
    photo_hash: photoFingerprint(l.photo_urls),
    status: 'active',
    checked_at: now.toISOString(),
    ...(l.posted_at ? { first_seen_at: l.posted_at } : {}),
  };
}

export function createSupabase(url = env.supabaseUrl, key = env.serviceRoleKey): SupabaseClient {
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (or use --dry-run)');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function createWriter(sb: SupabaseClient = createSupabase()): Writer {
  const fail = (op: string, e: { message: string } | null) => {
    if (e) throw new Error(`${op}: ${e.message}`);
  };

  return {
    async upsertActive(listings) {
      if (!listings.length) return { inserted: 0, updated: 0 };
      const urls = listings.map((l) => l.source_url);
      const existing = await this.knownUrls(urls);
      const rows = listings.map((l) => toRow(l));
      // never move first_seen_at on an update; supabase upsert would overwrite it
      const fresh = rows.filter((r) => !existing.has(r.source_url));
      const known = rows.filter((r) => existing.has(r.source_url)).map(({ first_seen_at: _drop, ...r }) => r);
      if (fresh.length) fail('insert listings', (await sb.from('listings').upsert(fresh, { onConflict: 'source_url' })).error);
      for (const r of known) fail('update listing', (await sb.from('listings').update(r).eq('source_url', r.source_url)).error);
      return { inserted: fresh.length, updated: known.length };
    },

    async writeRejected(l, code, dupOf) {
      if (l.price_eur === null) return; // price-less rows are not worth a row; scrape_runs.rejected counts them
      const row = { ...toRow(l), status: 'rejected' as const, attributes: { ...l.attributes, reject: code, ...(dupOf ? { dup_of: dupOf } : {}) } };
      fail('write rejected', (await sb.from('listings').upsert(row, { onConflict: 'source_url' })).error);
    },

    async knownUrls(urls) {
      const out = new Set<string>();
      for (let i = 0; i < urls.length; i += 200) {
        const { data, error } = await sb.from('listings').select('source_url').in('source_url', urls.slice(i, i + 200));
        fail('knownUrls', error);
        for (const r of data ?? []) out.add(r.source_url as string);
      }
      return out;
    },

    async activeCandidates(category) {
      const { data, error } = await sb
        .from('listings')
        .select('id, source_url, category, price_eur, photo_hash, photo_urls, attributes, title_hint')
        .eq('category', category)
        .eq('status', 'active')
        .limit(5000);
      fail('activeCandidates', error);
      return (data ?? []) as ExistingRow[];
    },

    async touch(urls) {
      if (!urls.length) return;
      fail('touch', (await sb.from('listings').update({ checked_at: new Date().toISOString() }).in('source_url', urls)).error);
    },

    async expire(urls) {
      if (!urls.length) return 0;
      const { data, error } = await sb.from('listings').update({ status: 'expired', checked_at: new Date().toISOString() }).in('source_url', urls).eq('status', 'active').select('id');
      fail('expire', error);
      return data?.length ?? 0;
    },

    async dueForRecheck(limit, olderThanDays) {
      const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
      const { data, error } = await sb.from('listings').select('source_url, category').eq('status', 'active').lt('checked_at', cutoff).order('checked_at', { ascending: true }).limit(limit);
      fail('dueForRecheck', error);
      return (data ?? []) as { source_url: string; category: SsCategory }[];
    },

    async dailyCandidates(limit) {
      // tomorrow's daily set, if already built, must be verified first (docs/03 order of work)
      const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
      const { data, error } = await sb.from('daily_sets').select('listing_ids').eq('day', tomorrow).maybeSingle();
      if (error || !data?.listing_ids?.length) return [];
      const ids = (data.listing_ids as number[]).slice(0, limit);
      const { data: rows } = await sb.from('listings').select('source_url, category').in('id', ids);
      return (rows ?? []) as { source_url: string; category: SsCategory }[];
    },

    async startRun(source, notes) {
      const { data, error } = await sb.from('scrape_runs').insert({ source, notes: notes ?? null }).select('id').single();
      fail('startRun', error);
      return data!.id as number;
    },

    async finishRun(id, stats) {
      fail('finishRun', (await sb.from('scrape_runs').update({ ...stats, finished_at: new Date().toISOString() }).eq('id', id)).error);
    },

    async lastBlockedUntil(source) {
      const { data } = await sb.from('scrape_runs').select('blocked_until').eq('source', source).not('blocked_until', 'is', null).order('blocked_until', { ascending: false }).limit(1).maybeSingle();
      return (data?.blocked_until as string | undefined) ?? null;
    },

    async runStats(limit) {
      const { data, error } = await sb.from('scrape_runs').select('*').order('started_at', { ascending: false }).limit(limit);
      fail('runStats', error);
      return (data ?? []) as ScrapeRunRow[];
    },

    async poolStats() {
      const { data, error } = await sb.from('listings').select('category, status').limit(100_000);
      fail('poolStats', error);
      const out: Record<string, Record<string, number>> = {};
      for (const r of data ?? []) ((out[r.category as string] ??= {})[r.status as string] = ((out[r.category as string] ??= {})[r.status as string] ?? 0) + 1);
      return out;
    },
  };
}

/** In-memory writer for --dry-run and tests. */
export function createMemoryWriter(): Writer & { rows: Map<string, ListingRow & { reject?: string }>; runs: ScrapeRunRow[] } {
  const rows = new Map<string, ListingRow & { reject?: string }>();
  const runs: ScrapeRunRow[] = [];
  let nextId = 1;
  return {
    rows,
    runs,
    async upsertActive(listings) {
      let inserted = 0;
      let updated = 0;
      for (const l of listings) {
        const r = toRow(l);
        if (rows.has(r.source_url)) {
          updated++;
          rows.set(r.source_url, { ...rows.get(r.source_url)!, ...r, first_seen_at: rows.get(r.source_url)!.first_seen_at });
        } else {
          inserted++;
          rows.set(r.source_url, r);
        }
      }
      return { inserted, updated };
    },
    async writeRejected(l, code) {
      if (l.price_eur === null) return;
      rows.set(l.source_url, { ...toRow(l), status: 'rejected', reject: code });
    },
    async knownUrls(urls) {
      return new Set(urls.filter((u) => rows.has(u)));
    },
    async activeCandidates(category) {
      return [...rows.values()]
        .filter((r) => r.category === category && r.status === 'active')
        .map((r) => ({ id: nextId++, source_url: r.source_url, category: r.category, price_eur: r.price_eur, photo_hash: r.photo_hash, photo_urls: r.photo_urls, attributes: r.attributes, title_hint: r.title_hint }));
    },
    async touch(urls) {
      for (const u of urls) if (rows.has(u)) rows.get(u)!.checked_at = new Date().toISOString();
    },
    async expire(urls) {
      let n = 0;
      for (const u of urls) {
        const r = rows.get(u);
        if (r && r.status === 'active') {
          r.status = 'expired';
          n++;
        }
      }
      return n;
    },
    async dueForRecheck(limit, olderThanDays) {
      const cutoff = Date.now() - olderThanDays * 86_400_000;
      return [...rows.values()]
        .filter((r) => r.status === 'active' && Date.parse(r.checked_at) < cutoff)
        .slice(0, limit)
        .map((r) => ({ source_url: r.source_url, category: r.category }));
    },
    async dailyCandidates() {
      return [];
    },
    async startRun(source, notes) {
      runs.push({ id: runs.length + 1, source, notes: notes ?? null, requests: 0, new_rows: 0, updated_rows: 0, expired_rows: 0, rejected: {}, errors: 0, started_at: new Date().toISOString() });
      return runs.length;
    },
    async finishRun(id, stats) {
      Object.assign(runs[id - 1]!, stats, { finished_at: new Date().toISOString() });
    },
    async lastBlockedUntil() {
      return null;
    },
    async runStats(limit) {
      return runs.slice(-limit).reverse();
    },
    async poolStats() {
      const out: Record<string, Record<string, number>> = {};
      for (const r of rows.values()) (out[r.category] ??= {})[r.status] = ((out[r.category] ??= {})[r.status] ?? 0) + 1;
      return out;
    },
  };
}
