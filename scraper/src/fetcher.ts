/**
 * The only module allowed to touch the network (docs/03). Serial, jittered,
 * cached, and paranoid about blocks: any block signal throws `BlockedError`
 * and the caller must stop the whole run and set `blocked_until`.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { BASE, BLOCK_WORDS, FORBIDDEN_PATH_RE, OUT_OF_FAMILY_HOSTS, env, politeness, userAgent } from './config.ts';
import type { FetchResult } from './types.ts';

export class BlockedError extends Error {
  constructor(
    public readonly url: string,
    public readonly reason: string,
    public readonly status: number,
  ) {
    super(`blocked: ${reason} on ${url}`);
  }
}
export class BudgetExhaustedError extends Error {}
export class ForbiddenUrlError extends Error {}

export interface FetcherOptions {
  intervalMs?: number;
  jitterMs?: number;
  timeoutMs?: number;
  budget?: number;
  cacheDir?: string | null; // null disables the cache
  cacheTtlDays?: number;
  mailto?: string;
  retryDelaysMs?: number[];
  /** injectable for tests; must mimic global fetch */
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<unknown>;
  log?: (line: string) => void;
}

export interface FetcherStats {
  requests: number;
  cacheHits: number;
  errors: number;
  elapsed: number[];
  zeroAnchorStreak: number;
}

/** Pure block heuristic (docs/03 "Blocking detection heuristics" 1-3). */
export function detectBlock(url: string, status: number, body: string, location: string | null): string | undefined {
  if (status === 403 || status === 429) return `status ${status}`;
  if (status === 503 && body.length < 5000) return 'status 503 with small body';
  const lower = body.slice(0, 200_000).toLowerCase();
  const w = BLOCK_WORDS.find((x) => lower.includes(x));
  if (w) return `body contains "${w}"`;
  if (location) {
    const target = new URL(location, url);
    if (OUT_OF_FAMILY_HOSTS.includes(target.hostname)) return `redirect to ${target.hostname}`;
    if (target.hostname !== new URL(url).hostname) return `redirect to foreign host ${target.hostname}`;
    const from = new URL(url).pathname;
    const norm = (p: string) => p.replace(/^\/(lv|ru)\//, '/'); // SS drops the /lv/ prefix on some redirects
    const family = norm(from.startsWith('/msg/') ? '/msg/' : from.split('/').slice(0, 4).join('/')); // /real-estate/flats
    // "pageN.html" beyond the last page redirects to the list root: end of pagination, not a block
    if (/page\d+\.html$/.test(from) && norm(target.pathname) === norm(from.replace(/page\d+\.html$/, ''))) return undefined;
    if (!norm(target.pathname).startsWith(family) && norm(target.pathname) !== norm(from)) return `redirect out of path family -> ${target.pathname}`;
  }
  return undefined;
}

/** robots + docs/12: never /en/, /photo/, *_f/, filter, currency, contact URLs. */
export function isAllowedUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.origin !== BASE) return false;
  if (FORBIDDEN_PATH_RE.test(u.pathname)) return false;
  if (!/^\/(lv|msg\/lv)\//.test(u.pathname)) return false;
  return true;
}

export class Fetcher {
  private lastRequestAt = 0;
  readonly stats: FetcherStats = { requests: 0, cacheHits: 0, errors: 0, elapsed: [], zeroAnchorStreak: 0 };
  private readonly o: Required<Omit<FetcherOptions, 'cacheDir'>> & { cacheDir: string | null };

  constructor(opts: FetcherOptions = {}) {
    this.o = {
      intervalMs: opts.intervalMs ?? politeness.intervalMs,
      jitterMs: opts.jitterMs ?? politeness.jitterMs,
      timeoutMs: opts.timeoutMs ?? politeness.timeoutMs,
      budget: opts.budget ?? politeness.nightlyBudget,
      cacheDir: opts.cacheDir === undefined ? env.cacheDir : opts.cacheDir,
      cacheTtlDays: opts.cacheTtlDays ?? politeness.cacheTtlDays,
      mailto: opts.mailto ?? env.mailto,
      retryDelaysMs: opts.retryDelaysMs ?? politeness.retryDelaysMs,
      fetchImpl: opts.fetchImpl ?? fetch,
      sleepImpl: opts.sleepImpl ?? ((ms) => sleep(ms)),
      log: opts.log ?? (() => {}),
    };
    if (this.o.cacheDir) mkdirSync(this.o.cacheDir, { recursive: true });
  }

  get remainingBudget() {
    return this.o.budget - this.stats.requests;
  }

  /** GET with cache, politeness, retries (network/5xx/timeout only) and block detection. */
  async get(url: string, { useCache = true, allowRetry = true }: { useCache?: boolean; allowRetry?: boolean } = {}): Promise<FetchResult> {
    if (!isAllowedUrl(url)) throw new ForbiddenUrlError(`refusing to fetch ${url}`);
    if (useCache) {
      const cached = this.readCache(url);
      if (cached) {
        this.stats.cacheHits++;
        return cached;
      }
    }
    let attempt = 0;
    for (;;) {
      if (this.remainingBudget <= 0) throw new BudgetExhaustedError(`nightly budget of ${this.o.budget} requests exhausted`);
      await this.waitTurn();
      this.stats.requests++;
      const t0 = performance.now();
      let res: Response;
      try {
        res = await this.o.fetchImpl(url, {
          method: 'GET',
          redirect: 'manual',
          signal: AbortSignal.timeout(this.o.timeoutMs),
          headers: {
            'User-Agent': userAgent(this.o.mailto),
            Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'lv,ru;q=0.7,en;q=0.3',
          },
        });
      } catch (e) {
        this.stats.errors++;
        this.o.log(`ERR  ${url} ${(e as Error).message}`);
        if (allowRetry && attempt < this.o.retryDelaysMs.length) {
          await this.o.sleepImpl(this.o.retryDelaysMs[attempt++]!);
          continue;
        }
        throw e;
      }
      const elapsedMs = Math.round(performance.now() - t0);
      this.stats.elapsed.push(elapsedMs);
      const html = await res.text();
      const location = res.headers.get('location');
      const reason = detectBlock(url, res.status, html, location);
      this.o.log(`${res.status} ${String(elapsedMs).padStart(5)}ms ${String(html.length).padStart(7)}B ${url}${reason ? `  BLOCK ${reason}` : ''}`);
      if (reason) throw new BlockedError(url, reason, res.status);

      if (res.status >= 500) {
        this.stats.errors++;
        if (allowRetry && attempt < this.o.retryDelaysMs.length) {
          await this.o.sleepImpl(this.o.retryDelaysMs[attempt++]!);
          continue;
        }
      }
      const result: FetchResult = {
        url,
        finalUrl: location ? new URL(location, url).toString() : url,
        status: res.status,
        html,
        fetchedAt: new Date().toISOString(),
        elapsedMs,
        fromCache: false,
        location,
      };
      if (res.status === 200 && useCache) this.writeCache(url, result);
      return result;
    }
  }

  /** Heuristic 5: median of last 20 > 4x median of first 20. */
  latencyDegraded(): boolean {
    const e = this.stats.elapsed;
    if (e.length < 40) return false;
    const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    return med(e.slice(-20)) > 4 * Math.max(med(e.slice(0, 20)), 50);
  }

  private async waitTurn() {
    const jitter = (Math.random() * 2 - 1) * this.o.jitterMs;
    const wait = this.lastRequestAt + this.o.intervalMs + jitter - Date.now();
    if (wait > 0) await this.o.sleepImpl(wait);
    this.lastRequestAt = Date.now();
  }

  // ─── disk cache (7 d) ──────────────────────────────────────────────────────

  private cachePath(url: string) {
    return join(this.o.cacheDir!, `${createHash('sha1').update(url).digest('hex')}.json`);
  }

  private readCache(url: string): FetchResult | null {
    if (!this.o.cacheDir) return null;
    const p = this.cachePath(url);
    if (!existsSync(p)) return null;
    try {
      const st = statSync(p);
      if (Date.now() - st.mtimeMs > this.o.cacheTtlDays * 86_400_000) {
        unlinkSync(p);
        return null;
      }
      const r = JSON.parse(readFileSync(p, 'utf8')) as FetchResult;
      return { ...r, fromCache: true };
    } catch {
      return null;
    }
  }

  private writeCache(url: string, r: FetchResult) {
    if (!this.o.cacheDir) return;
    try {
      writeFileSync(this.cachePath(url), JSON.stringify(r));
    } catch {
      /* cache is best effort */
    }
  }

  /** Delete cache files older than the TTL. Returns count removed. */
  pruneCache(): number {
    if (!this.o.cacheDir || !existsSync(this.o.cacheDir)) return 0;
    let n = 0;
    const cutoff = Date.now() - this.o.cacheTtlDays * 86_400_000;
    for (const f of readdirSync(this.o.cacheDir)) {
      const p = join(this.o.cacheDir, f);
      try {
        if (statSync(p).mtimeMs < cutoff) {
          unlinkSync(p);
          n++;
        }
      } catch {
        /* ignore */
      }
    }
    return n;
  }
}
