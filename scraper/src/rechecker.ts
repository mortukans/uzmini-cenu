/**
 * Expiry rechecks (docs/03): re-fetch active listings whose `checked_at` is
 * older than 3 d, oldest first; 404 or "sludinājums nav atrasts" → expired,
 * 200 with a price → bump checked_at (and refresh price if it changed).
 *
 * A live detail page is not enough: SS removes an ad's photos before the ad,
 * and i.ss.com then answers 200 with a 1×1 GIF for every photo URL (the app
 * rendered a blank box). So an alive page is followed by one HEAD of the first
 * photo; a dead photo expires the row with `attributes.reject_reason =
 * 'photo_dead'`. Each target therefore costs up to two requests of the budget.
 */
import { politeness } from './config.ts';
import { BlockedError, BudgetExhaustedError, isPhotoAlive, type Fetcher } from './fetcher.ts';
import { parsePrice } from './normaliser.ts';
import { detailIsGone, parseDetail } from './parser/ss.ts';
import type { RecheckTarget, Writer } from './writer.ts';

export interface RecheckStats {
  checked: number;
  expired: number;
  /** Subset of `expired`: page alive, first photo dead on the CDN. */
  photoDead: number;
  alive: number;
  errors: number;
  priceChanged: number;
}

/** Requests one recheck may cost: the detail page plus the photo HEAD. */
export const REQUESTS_PER_RECHECK = 2;

export async function recheck(
  fetcher: Fetcher,
  writer: Writer,
  targets: RecheckTarget[],
  opts: { log?: (s: string) => void; dryRun?: boolean } = {},
): Promise<RecheckStats> {
  const log = opts.log ?? (() => {});
  const stats: RecheckStats = { checked: 0, expired: 0, photoDead: 0, alive: 0, errors: 0, priceChanged: 0 };
  const alive: string[] = [];
  const gone: string[] = [];
  const photoDead: string[] = [];
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
      // Photo liveness: the stored first photo is what the app shows; fall back
      // to the page's first photo when the row has none on record.
      const photo = t.photo_urls?.[0] ?? d.photoUrls[0];
      if (!photo) {
        photoDead.push(t.source_url);
        stats.expired++;
        stats.photoDead++;
        log(`expired ${t.source_url} (no photos on page)`);
        continue;
      }
      let photoOk: boolean | null;
      try {
        photoOk = isPhotoAlive(await fetcher.head(photo));
      } catch (e) {
        if (e instanceof BlockedError || e instanceof BudgetExhaustedError) throw e;
        photoOk = null; // network hiccup: inconclusive, the page itself was alive
        stats.errors++;
      }
      if (photoOk === false) {
        photoDead.push(t.source_url);
        stats.expired++;
        stats.photoDead++;
        log(`expired ${t.source_url} (photo_dead ${photo})`);
        continue;
      }
      alive.push(t.source_url);
      stats.alive++;
    }
  } finally {
    if (!opts.dryRun) {
      await writer.touch(alive);
      await writer.expire(gone);
      await writer.expirePhotoDead(photoDead);
    }
  }
  return stats;
}

export const recheckDefaults = { limit: politeness.recheckBudget, olderThanDays: politeness.recheckAfterDays };
