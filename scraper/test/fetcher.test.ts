import { describe, expect, it } from 'vitest';
import { buildListJobs, pageUrl } from '../src/config.ts';
import { BlockedError, Fetcher, ForbiddenUrlError, detectBlock, isAllowedUrl } from '../src/fetcher.ts';

describe('isAllowedUrl', () => {
  it.each([
    ['https://www.ss.com/lv/real-estate/flats/riga/purvciems/sell/', true],
    ['https://www.ss.com/lv/real-estate/flats/riga/purvciems/sell/page2.html', true],
    ['https://www.ss.com/msg/lv/transport/cars/audi/a4/bbifnf.html', true],
    ['https://www.ss.com/en/real-estate/flats/', false],
    ['https://www.ss.com/ru/real-estate/flats/', false],
    ['https://www.ss.com/lv/real-estate/flats/riga_f/', false],
    ['https://www.ss.com/lv/real-estate/flats/photo/', false],
    ['https://www.ss.com/lv/real-estate/flats/riga/purvciems/sell/fDgSeF4bRDwT.html', false],
    ['https://www.ss.com/lv/real-estate/flats/riga/purvciems/search/', false],
    ['https://www.ss.com/lv/eur/', false],
    ['https://m.ss.com/lv/real-estate/flats/', false],
    ['https://www.ss.com/msg/en/x/y.html', false],
  ])('%s → %s', (u, ok) => expect(isAllowedUrl(u)).toBe(ok));
});

describe('detectBlock', () => {
  const list = 'https://www.ss.com/lv/real-estate/flats/riga/purvciems/sell/';
  it('status codes', () => {
    expect(detectBlock(list, 403, '', null)).toMatch(/403/);
    expect(detectBlock(list, 429, '', null)).toMatch(/429/);
    expect(detectBlock(list, 503, 'x'.repeat(100), null)).toMatch(/503/);
    expect(detectBlock(list, 503, 'x'.repeat(10_000), null)).toBeUndefined();
    expect(detectBlock(list, 200, '<html>ok</html>', null)).toBeUndefined();
  });
  it('captcha words', () => {
    expect(detectBlock(list, 200, '<div class="g-recaptcha">', null)).toMatch(/captcha/);
    expect(detectBlock(list, 200, 'Jūs esat bloķēts', null)).toMatch(/bloķēts/);
  });
  it('redirects', () => {
    expect(detectBlock(list, 302, '', 'https://m.ss.com/lv/real-estate/flats/riga/purvciems/sell/')).toMatch(/m\.ss\.com/);
    expect(detectBlock(list, 302, '', '/lv/')).toMatch(/out of path family/);
    expect(detectBlock(list, 302, '', '/lv/real-estate/flats/riga/purvciems/sell/page1.html')).toBeUndefined();
    expect(detectBlock('https://www.ss.com/msg/lv/x/y/abcde.html', 302, '', '/msg/lv/x/y/abcde.html')).toBeUndefined();
  });
});

const mkResponse = (status: number, body: string, headers: Record<string, string> = {}) => new Response(body, { status, headers });

describe('Fetcher (no network: injected fetch)', () => {
  it('serialises, caches to disk off, retries 5xx with the backoff table then returns', async () => {
    const calls: string[] = [];
    const sleeps: number[] = [];
    let n = 0;
    const f = new Fetcher({
      cacheDir: null,
      intervalMs: 0,
      jitterMs: 0,
      retryDelaysMs: [1, 2, 3],
      fetchImpl: (async (u: string | URL | Request) => {
        calls.push(String(u));
        n++;
        return n < 3 ? mkResponse(500, 'err') : mkResponse(200, '<html>ok</html>');
      }) as typeof fetch,
      sleepImpl: async (ms) => void sleeps.push(ms),
    });
    const r = await f.get('https://www.ss.com/lv/real-estate/flats/riga/purvciems/sell/');
    expect(r.status).toBe(200);
    expect(calls).toHaveLength(3);
    expect(sleeps.filter((s) => s >= 1)).toEqual([1, 2]);
    expect(f.stats.requests).toBe(3);
    expect(f.stats.errors).toBe(2);
  });

  it('throws BlockedError on 403 and never retries', async () => {
    let n = 0;
    const f = new Fetcher({ cacheDir: null, intervalMs: 0, fetchImpl: (async () => (n++, mkResponse(403, 'Forbidden'))) as typeof fetch, sleepImpl: async () => {} });
    await expect(f.get('https://www.ss.com/lv/transport/cars/audi/sell/')).rejects.toBeInstanceOf(BlockedError);
    expect(n).toBe(1);
  });

  it('throws on m.ss.com redirect (phone-UA symptom) and on forbidden URLs without fetching', async () => {
    let n = 0;
    const f = new Fetcher({ cacheDir: null, intervalMs: 0, fetchImpl: (async () => (n++, mkResponse(302, '', { location: 'https://m.ss.com/msg/lv/x/y/abcde.html' }))) as typeof fetch, sleepImpl: async () => {} });
    await expect(f.get('https://www.ss.com/msg/lv/x/y/abcde.html')).rejects.toBeInstanceOf(BlockedError);
    await expect(f.get('https://www.ss.com/en/real-estate/flats/')).rejects.toBeInstanceOf(ForbiddenUrlError);
    expect(n).toBe(1);
  });

  it('honours the request budget', async () => {
    const f = new Fetcher({ cacheDir: null, intervalMs: 0, budget: 1, fetchImpl: (async () => mkResponse(200, 'ok')) as typeof fetch, sleepImpl: async () => {} });
    await f.get('https://www.ss.com/lv/transport/cars/audi/sell/', { useCache: false });
    await expect(f.get('https://www.ss.com/lv/transport/cars/bmw/sell/', { useCache: false })).rejects.toThrow(/budget/);
  });

  it('sends the bot UA with mailto', async () => {
    let ua = '';
    const f = new Fetcher({ cacheDir: null, intervalMs: 0, mailto: 'dev@example.lv', fetchImpl: (async (_u: unknown, init?: RequestInit) => ((ua = (init!.headers as Record<string, string>)['User-Agent']!), mkResponse(200, 'ok'))) as typeof fetch, sleepImpl: async () => {} });
    await f.get('https://www.ss.com/lv/transport/cars/audi/sell/', { useCache: false });
    expect(ua).toBe('UzminiCenuBot/1.0 (+mailto:dev@example.lv)');
  });
});

describe('config crawl plan', () => {
  it('builds ~170 list jobs, all /sell/, no forbidden paths, houses with /all/', () => {
    const jobs = buildListJobs();
    expect(jobs.filter((j) => j.category === 'flats')).toHaveLength(26);
    expect(jobs.filter((j) => j.category === 'cars')).toHaveLength(25);
    expect(jobs.filter((j) => j.category === 'random')).toHaveLength(6);
    expect(jobs.every((j) => j.url.endsWith('/sell/') && isAllowedUrl(j.url))).toBe(true);
    expect(jobs.filter((j) => j.category === 'houses').every((j) => j.url.includes('/all/sell/'))).toBe(true);
    const pages = jobs.reduce((s, j) => s + j.pages, 0);
    expect(pages).toBeGreaterThan(150);
    expect(pages).toBeLessThan(200);
    expect(pageUrl(jobs[0]!.url, 1)).toBe(jobs[0]!.url);
    expect(pageUrl(jobs[0]!.url, 3)).toBe(`${jobs[0]!.url}page3.html`);
  });
});
