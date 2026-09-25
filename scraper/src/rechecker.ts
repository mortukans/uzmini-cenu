/**
 * Expiry rechecks (docs/03): re-fetch active listings whose `checked_at` is
 * older than 3 d, oldest first; 404 or "sludinājums nav atrasts" → expired,
 * 200 with a price → bump checked_at (and refresh price if it changed).
 */
import { politeness } from './config.ts';
import { BlockedError, BudgetExhaustedError, type Fetcher } from './fetcher.ts';
import { parsePrice } from './normaliser.ts';
import { detailIsGone, parseDetail } from './parser/ss.ts';
import type { Writer } from './writer.ts';

export interface RecheckStats {
  checked: number;
  expired: number;
  alive: number;
  errors: number;
  priceChanged: number;
}

export async function recheck(
  fetcher: Fetcher,
  writer: Writer,
  targets: { source_url: string }[],
  opts: { log?: (s: string) => void; dryRun?: boolean } = {},
): Promise<RecheckStats> {
  const log = opts.log ?? (() => {});
  const stats: RecheckStats = { checked: 0, expired: 0, alive: 0, errors: 0, priceChanged: 0 };
  const alive: string[] = [];
  const gone: string[] = [];
  try {
    for (const t of targets) {
      let r;
      try {
        r = await fetcher.get(t.source_url, { useCache: false });
      } catch (e) {
        if (e instanceof BlockedError || e instanceof BudgetExhaustedError) throw e;
        stats.errors++;
        continue;
      }
      stats.checked++;
      // a redirect away from the ad (e.g. to the list) also means gone
      const redirected = r.status >= 300 && r.status < 400;
      if (detailIsGone(r.status, r.html) || redirected) {
        gone.push(t.source_url);
        stats.expired++;
        log(`expired ${t.source_url} (${redirected ? `redirect ${r.location}` : r.status})`);
        continue;
      }
      const d = parseDetail(r.html, t.source_url);
      const p = parsePrice(d.priceText);
      if (p.kind !== 'sell') {
        gone.push(t.source_url); // became rent/buy/no price: not playable any more
        stats.expired++;
        continue;
      }
      alive.push(t.source_url);
      stats.alive++;
    }
  } finally {
    if (!opts.dryRun) {
      await writer.touch(alive);
      await writer.expire(gone);
    }
  }
  return stats;
}

export const recheckDefaults = { limit: politeness.recheckBudget, olderThanDays: politeness.recheckAfterDays };
