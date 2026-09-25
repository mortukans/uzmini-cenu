/**
 * Builds and runs one night's job queue (docs/03 "Scheduling", "Order of work"):
 *   1. rechecks of tomorrow's daily-set candidates
 *   2. list pages (all categories, interleaved so one broken tree does not eat the budget)
 *   3. detail pages for new rows that passed the list-stage filter
 *   4. remaining rechecks (cut first if the budget runs out)
 * A block signal stops everything and records `blocked_until`.
 */
import { buildListJobs, pageUrl, politeness, type ListJob } from './config.ts';
import { findDuplicate } from './deduper.ts';
import { BlockedError, BudgetExhaustedError, type Fetcher } from './fetcher.ts';
import { normalise, parsePrice } from './normaliser.ts';
import { parseDetail, parseList } from './parser/ss.ts';
import { checkQuality, listStageReject } from './quality.ts';
import { recheck } from './rechecker.ts';
import type { ParsedListing, RawListing, RejectCode, ScrapeRunRow, SsCategory, SsRawListRow } from './types.ts';
import type { Writer } from './writer.ts';

export interface RunOptions {
  categories?: SsCategory[];
  limit?: number; // max detail fetches (dev: SCRAPER_LIMIT)
  dryRun?: boolean;
  skipRechecks?: boolean;
  log?: (s: string) => void;
  /** dry-run collector */
  onListing?: (l: ParsedListing, verdict: { ok: true } | { ok: false; reject: RejectCode }) => void;
}

export interface RunReport extends ScrapeRunRow {
  listPages: number;
  detailPages: number;
  zeroRowPages: string[];
  blocked?: { url: string; reason: string };
}

export async function runNight(fetcher: Fetcher, writer: Writer, opts: RunOptions = {}): Promise<RunReport> {
  const log = opts.log ?? (() => {});
  const report: RunReport = { source: 'ss', requests: 0, new_rows: 0, updated_rows: 0, expired_rows: 0, rejected: {}, errors: 0, listPages: 0, detailPages: 0, zeroRowPages: [] };
  const bumpReject = (c: string) => (report.rejected[c] = (report.rejected[c] ?? 0) + 1);
  const runId = opts.dryRun ? 0 : await writer.startRun('ss', `categories=${(opts.categories ?? ['all']).join(',')}`);

  try {
    // 0. second-consecutive-night guard
    const blockedUntil = await writer.lastBlockedUntil('ss');
    if (blockedUntil && Date.parse(blockedUntil) > Date.now()) {
      report.notes = `skipped: blocked_until ${blockedUntil}`;
      log(report.notes);
      return report;
    }

    // 1. daily-set candidates first
    if (!opts.skipRechecks && !opts.dryRun) {
      const cands = await writer.dailyCandidates(10);
      if (cands.length) {
        const s = await recheck(fetcher, writer, cands, { log });
        report.expired_rows += s.expired;
        log(`daily candidates rechecked: ${JSON.stringify(s)}`);
      }
    }

    // 2. list pages, round-robin over jobs so every category gets page 1 before anyone gets page 3
    const jobs = buildListJobs(opts.categories);
    const queue: { job: ListJob; page: number }[] = [];
    const maxPages = Math.max(...jobs.map((j) => j.pages));
    for (let p = 1; p <= maxPages; p++) for (const job of jobs) if (p <= job.pages) queue.push({ job, page: p });

    const candidates: RawListing[] = [];
    const seenUrls = new Set<string>();
    const zeroStreak = new Map<string, number>();

    for (const { job, page } of queue) {
      if ((zeroStreak.get(job.url) ?? 0) > 0) continue; // page 1 was empty: unknown slug or index page, skip deeper pages
      const url = pageUrl(job.url, page);
      const r = await fetcher.get(url);
      report.listPages++;
      if (r.status !== 200) {
        report.errors++;
        continue;
      }
      let rows = parseList(r.html);
      if (rows.length === 0) {
        // docs/03: retry once after 60 s (skip the wait in dry-run), then raise parser_zero_rows
        if (!opts.dryRun) {
          const again = await fetcher.get(url, { useCache: false });
          rows = parseList(again.html);
        }
        if (rows.length === 0) {
          zeroStreak.set(job.url, 1);
          report.zeroRowPages.push(url);
          log(`parser_zero_rows ${url}${job.unverified ? ' (unverified slug)' : ''}`);
          continue;
        }
      }
      for (const row of rows) {
        if (seenUrls.has(row.sourceUrl)) continue;
        seenUrls.add(row.sourceUrl);
        const code = listStageReject(parsePrice(row.cells.at(-1)).kind, job.url);
        if (code) {
          bumpReject(code);
          continue;
        }
        candidates.push({ category: job.category, listUrl: job.url, row });
      }
    }
    log(`list stage: ${report.listPages} pages, ${candidates.length} candidate rows`);

    // 3. detail pages for rows we do not have yet
    const known = opts.dryRun ? new Set<string>() : await writer.knownUrls(candidates.map((c) => c.row.sourceUrl));
    if (!opts.dryRun) await writer.touch(candidates.filter((c) => known.has(c.row.sourceUrl)).map((c) => c.row.sourceUrl));
    // round-robin across categories so a small --limit still yields a mix
    const freshAll = candidates.filter((c) => !known.has(c.row.sourceUrl));
    const byCat = new Map<string, typeof freshAll>();
    for (const c of freshAll) byCat.set(c.category, [...(byCat.get(c.category) ?? []), c]);
    const fresh: typeof freshAll = [];
    for (let i = 0; byCat.size && fresh.length < freshAll.length; i++) for (const q of byCat.values()) { const c = q[i]; if (c) fresh.push(c); }
    const detailBudget = Math.min(opts.limit ?? politeness.detailBudget, politeness.detailBudget);
    const accepted: ParsedListing[] = [];
    const activeByCat = new Map<SsCategory, Awaited<ReturnType<Writer['activeCandidates']>>>();

    for (const c of fresh.slice(0, detailBudget)) {
      const r = await fetcher.get(c.row.sourceUrl);
      report.detailPages++;
      if (r.status === 404) {
        bumpReject('gone_before_fetch');
        continue;
      }
      if (r.status !== 200) {
        report.errors++;
        continue;
      }
      c.detail = parseDetail(r.html, c.row.sourceUrl);
      if (c.detail.notFound) {
        bumpReject('gone_before_fetch');
        continue;
      }
      const listing = normalise(c);
      const q = checkQuality(listing);
      if (!q.ok) {
        bumpReject(q.reject);
        opts.onListing?.(listing, { ok: false, reject: q.reject });
        if (!opts.dryRun) await writer.writeRejected(listing, q.reject);
        continue;
      }
      if (!opts.dryRun) {
        if (!activeByCat.has(c.category)) activeByCat.set(c.category, await writer.activeCandidates(c.category));
        const dup = findDuplicate(q.listing, [...activeByCat.get(c.category)!, ...accepted.filter((a) => a.category === c.category).map(asExisting)]);
        if (dup.dup) {
          bumpReject(dup.code);
          await writer.writeRejected(q.listing, dup.code, dup.of);
          opts.onListing?.(q.listing, { ok: false, reject: dup.code });
          continue;
        }
      }
      accepted.push(q.listing);
      opts.onListing?.(q.listing, { ok: true });
    }
    if (!opts.dryRun && accepted.length) {
      const w = await writer.upsertActive(accepted);
      report.new_rows += w.inserted;
      report.updated_rows += w.updated + candidates.length - fresh.length;
    } else report.new_rows = accepted.length;

    // 4. remaining rechecks
    if (!opts.skipRechecks && !opts.dryRun) {
      const due = await writer.dueForRecheck(Math.min(politeness.recheckBudget, Math.max(0, fetcher.remainingBudget - 5)), politeness.recheckAfterDays);
      if (due.length) {
        const s = await recheck(fetcher, writer, due, { log });
        report.expired_rows += s.expired;
        report.errors += s.errors;
      }
    }
  } catch (e) {
    if (e instanceof BlockedError) {
      report.blocked = { url: e.url, reason: e.reason };
      report.blocked_until = new Date(Date.now() + politeness.blockHours * 3600_000).toISOString();
      report.notes = `BLOCKED: ${e.reason} on ${e.url}. Hard stop; no retries, no IP change.`;
      log(report.notes);
    } else if (e instanceof BudgetExhaustedError) {
      report.notes = e.message;
      log(report.notes);
    } else {
      report.errors++;
      report.notes = `crash: ${(e as Error).message}`;
      throw e;
    }
  } finally {
    report.requests = fetcher.stats.requests;
    report.errors += fetcher.stats.errors;
    if (fetcher.latencyDegraded()) report.notes = `${report.notes ?? ''} latency_degraded`.trim();
    if (!opts.dryRun) {
      const { listPages: _l, detailPages: _d, zeroRowPages: _z, blocked: _b, ...row } = report;
      await writer.finishRun(runId, row);
    }
  }
  return report;
}

/** Let freshly accepted rows of this run participate in dedupe against each other. */
function asExisting(l: ParsedListing) {
  return { id: -1, source_url: l.source_url, category: l.category, price_eur: l.price_eur ?? 0, photo_hash: null, photo_urls: l.photo_urls, attributes: l.attributes, title_hint: l.title_hint };
}

export const listRowsToCandidates = (category: SsCategory, listUrl: string, rows: SsRawListRow[]): RawListing[] => rows.map((row) => ({ category, listUrl, row }));
