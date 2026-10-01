/**
 * Dead-photo detection (no network: injected fetch). SS.com removes an ad's
 * photos before the ad itself; i.ss.com then answers HTTP 200 with a 49-byte
 * 1×1 GIF for every photo URL, so a live detail page alone proves nothing.
 */
import { describe, expect, it } from 'vitest';
import { Fetcher } from '../src/fetcher.ts';
import { recheck } from '../src/rechecker.ts';
import { runNight } from '../src/scheduler.ts';
import { createMemoryWriter } from '../src/writer.ts';
import { URLS, fixture } from './helpers.ts';

const PHOTO = 'https://i.ss.com/gallery/8/1513/378190/flats-riga-purvciems-75637961.800.jpg';
const GIF_49 = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'); // 1×1 transparent GIF

const gifHead = () => new Response(null, { status: 200, headers: { 'content-type': 'image/gif', 'content-length': String(GIF_49.length) } });
const jpegHead = () => new Response(null, { status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': '48213' } });

/** Detail pages come from the flats fixture; photo HEADs from `photo`. */
function fakeFetch(photo: () => Response | Promise<Response>, calls: { method: string; url: string }[] = []) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ method: init?.method ?? 'GET', url });
    if (url.startsWith('https://i.ss.com/')) {
      expect(init?.method).toBe('HEAD');
      return photo();
    }
    if (url.includes('/msg/')) return new Response(fixture('flats/detail-hxnxd.html'), { status: 200 });
    return new Response(fixture('flats/list-purvciems.html'), { status: 200 });
  }) as typeof fetch;
}

const quiet = { cacheDir: null, intervalMs: 0, jitterMs: 0, sleepImpl: async () => {} } as const;

describe('recheck: photo liveness', () => {
  it('expires a listing whose page is alive but whose first photo is the 49-byte GIF', async () => {
    const calls: { method: string; url: string }[] = [];
    const f = new Fetcher({ ...quiet, fetchImpl: fakeFetch(gifHead, calls) });
    const w = createMemoryWriter();
    const old = new Date(Date.now() - 10 * 86_400_000).toISOString();
    w.rows.set(URLS.flatHxnxd, {
      source: 'ss', source_url: URLS.flatHxnxd, category: 'flats', price_eur: 52_000, region: 'riga', location: 'Purvciems',
      attributes: { rooms: 2, m2: 50 }, title_hint: null, photo_urls: [PHOTO], photo_hash: null, status: 'active', checked_at: old,
    });

    const stats = await recheck(f, w, await w.dueForRecheck(10, 3));

    expect(stats).toMatchObject({ checked: 1, expired: 1, photoDead: 1, alive: 0, errors: 0 });
    const row = w.rows.get(URLS.flatHxnxd)!;
    expect(row.status).toBe('expired');
    expect(row.attributes.reject_reason).toBe('photo_dead');
    expect(row.attributes.rooms).toBe(2); // merged, not replaced
    // one GET for the page, one HEAD for the stored first photo, both on the budget
    expect(calls.map((c) => c.method)).toEqual(['GET', 'HEAD']);
    expect(calls[1]!.url).toBe(PHOTO);
    expect(f.stats.requests).toBe(2);
  });

  it('keeps a listing alive (touched) when the first photo is a real JPEG', async () => {
    const f = new Fetcher({ ...quiet, fetchImpl: fakeFetch(jpegHead) });
    const w = createMemoryWriter();
    const old = new Date(Date.now() - 10 * 86_400_000).toISOString();
    w.rows.set(URLS.flatHxnxd, {
      source: 'ss', source_url: URLS.flatHxnxd, category: 'flats', price_eur: 52_000, region: 'riga', location: null,
      attributes: {}, title_hint: null, photo_urls: [PHOTO], photo_hash: null, status: 'active', checked_at: old,
    });
    const stats = await recheck(f, w, [{ source_url: URLS.flatHxnxd, category: 'flats', photo_urls: [PHOTO] }]);
    expect(stats).toMatchObject({ checked: 1, expired: 0, photoDead: 0, alive: 1 });
    const row = w.rows.get(URLS.flatHxnxd)!;
    expect(row.status).toBe('active');
    expect(Date.parse(row.checked_at)).toBeGreaterThan(Date.parse(old));
    expect(row.attributes.reject_reason).toBeUndefined();
  });

  it('a 404 or a non-JPEG content type on the photo also means photo_dead', async () => {
    for (const res of [() => new Response(null, { status: 404 }), () => new Response(null, { status: 200, headers: { 'content-type': 'text/html', 'content-length': '50000' } })]) {
      const f = new Fetcher({ ...quiet, fetchImpl: fakeFetch(res) });
      const w = createMemoryWriter();
      const stats = await recheck(f, w, [{ source_url: URLS.flatHxnxd, category: 'flats', photo_urls: [PHOTO] }]);
      expect(stats.photoDead).toBe(1);
    }
  });

  it('a network error on the HEAD is inconclusive: the row stays alive, counted as an error', async () => {
    const f = new Fetcher({ ...quiet, fetchImpl: fakeFetch(() => Promise.reject(new TypeError('fetch failed'))) });
    const w = createMemoryWriter();
    const stats = await recheck(f, w, [{ source_url: URLS.flatHxnxd, category: 'flats', photo_urls: [PHOTO] }]);
    expect(stats).toMatchObject({ checked: 1, expired: 0, photoDead: 0, alive: 1, errors: 1 });
  });

  it('falls back to the page\'s first photo when the row has none on record', async () => {
    const calls: { method: string; url: string }[] = [];
    const f = new Fetcher({ ...quiet, fetchImpl: fakeFetch(gifHead, calls) });
    const stats = await recheck(f, createMemoryWriter(), [{ source_url: URLS.flatHxnxd, category: 'flats' }], { dryRun: true });
    expect(stats.photoDead).toBe(1);
    expect(calls[1]!.url).toBe(PHOTO); // first .800.jpg of detail-hxnxd.html
  });
});

describe('runNight: new listings are HEAD-checked at ingest', () => {
  it('drops a fresh listing with a dead first photo as reject photo_dead (one HEAD per accepted row)', async () => {
    const calls: { method: string; url: string }[] = [];
    const f = new Fetcher({ ...quiet, fetchImpl: fakeFetch(gifHead, calls) });
    const w = createMemoryWriter();
    const report = await runNight(f, w, { categories: ['flats'], limit: 1, skipRechecks: true });

    expect(report.detailPages).toBe(1);
    expect(report.rejected.photo_dead).toBe(1);
    expect(report.new_rows).toBe(0);
    expect(calls.filter((c) => c.method === 'HEAD')).toHaveLength(1);
    const rejected = [...w.rows.values()].filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reject).toBe('photo_dead');
    expect(report.requests).toBe(f.stats.requests); // HEAD counted against the nightly budget
    expect(report.requests).toBe(report.listPages + report.detailPages + 1);
  });

  it('accepts the same listing when the photo is a real JPEG', async () => {
    const f = new Fetcher({ ...quiet, fetchImpl: fakeFetch(jpegHead) });
    const w = createMemoryWriter();
    const report = await runNight(f, w, { categories: ['flats'], limit: 1, skipRechecks: true });
    expect(report.new_rows).toBe(1);
    expect(report.rejected.photo_dead).toBeUndefined();
    expect([...w.rows.values()].filter((r) => r.status === 'active')).toHaveLength(1);
  });
});
