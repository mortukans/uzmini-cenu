/**
 * Regression tests for the session store (src/game/session.ts) around session
 * start-up: solo/streak must fetch their first pool, and LOADING/STAGED must
 * never hang (TestFlight build 20: only Daily worked, solo/streak sat on the
 * skeleton forever because the pool fetch was only triggered on a LOADING
 * phase *change* and the store was already LOADING), plus the listing-filter
 * plumbing: filters reach get_rounds_filtered, excludeIds grows across refills
 * and a dry filtered pool ends the session on the summary.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FILTERS, type ListingFilters, type Round } from '../api/types';

(globalThis as { __DEV__?: boolean }).__DEV__ = false;

const rpc = vi.hoisted(() => ({
  getRoundsFiltered: vi.fn(),
  getDaily: vi.fn(),
  submitGuess: vi.fn(),
  submitDaily: vi.fn(),
}));
const image = vi.hoisted(() => ({ prefetch: vi.fn() }));

vi.mock('expo-image', () => ({ Image: image }));
vi.mock('../api/rpc', () => ({
  ...rpc,
  RpcError: class RpcError extends Error { constructor(public code: string, public hint?: string) { super(code); } },
}));
vi.mock('../auth/store', () => ({ useAuth: { getState: () => ({ hasUsername: false }) } }));
vi.mock('../env', () => ({ isConfigured: true, env: {} }));
vi.mock('../analytics', () => ({ track: vi.fn() }));
vi.mock('./storage', () => ({
  bumpDailyStreak: vi.fn(async () => 1), getDailyProgress: vi.fn(async () => null), getHintTokens: vi.fn(async () => 0),
  getStreakBests: vi.fn(async () => ({})), recordStreakBest: vi.fn(async () => 0), setDailyLocalResult: vi.fn(async () => {}),
  setDailyProgress: vi.fn(async () => {}), setHintTokens: vi.fn(async () => {}), setStreakCurrent: vi.fn(async () => {}),
}));

import { RpcError } from '../api/rpc';
import { STAGED_TIMEOUT_MS, encodeSessionId } from './machine';
import { sessionActions, useSession } from './session';

const round = (id: number): Round => ({
  id, category: 'flats', region: 'riga', location: 'Purvciems', attributes: { m2: 65, rooms: 3 },
  title_hint: null, photo_urls: [`https://i.ss.com/${id}.800.jpg`],
  source: 'ss.com', source_url: 'https://ss.com/x', token: `tok-${id}`,
});
const pool = (n: number, from = 1) => Array.from({ length: n }, (_, i) => round(from + i));

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
/** STAGED or GUESSING: the pool arrived and the round is on screen. */
const expectPlaying = () => expect(['STAGED', 'GUESSING']).toContain(useSession.getState().phase);

describe('startSession (solo / streak)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    rpc.getRoundsFiltered.mockReset();
    image.prefetch.mockReset().mockResolvedValue(true);
    sessionActions.reset();
  });
  afterEach(() => { sessionActions.reset(); vi.useRealTimers(); });

  it('fetches the first pool from a cold LOADING store and reaches GUESSING', async () => {
    rpc.getRoundsFiltered.mockResolvedValue(pool(10));
    await sessionActions.startSession({ mode: 'solo', category: 'flats', region: 'riga', sessionId: 'solo:flats:riga' });
    await flush();
    expect(rpc.getRoundsFiltered).toHaveBeenCalledTimes(1);
    expect(rpc.getRoundsFiltered).toHaveBeenCalledWith('flats', 'riga', DEFAULT_FILTERS, 10, []);
    await flush(); // prefetch resolved → PHOTO_READY
    expect(useSession.getState().phase).toBe('GUESSING');
    expect(useSession.getState().rounds[0]?.id).toBe(1);
  });

  it('streak:all passes category "all" and region null to get_rounds', async () => {
    rpc.getRoundsFiltered.mockResolvedValue(pool(10));
    await sessionActions.startSession({ mode: 'streak', category: 'all', region: null, sessionId: 'streak:all', streak: 0 });
    await flush();
    expect(rpc.getRoundsFiltered).toHaveBeenCalledWith('all', null, DEFAULT_FILTERS, 10, []);
    expectPlaying();
  });

  it('play again (SUMMARY → startSession) fetches a fresh pool too', async () => {
    rpc.getRoundsFiltered.mockResolvedValue(pool(10));
    await sessionActions.startSession({ mode: 'solo', category: 'all', sessionId: 'solo:all' });
    await flush();
    sessionActions.end();
    expect(useSession.getState().phase).toBe('SUMMARY');
    rpc.getRoundsFiltered.mockResolvedValue(pool(10, 100));
    await sessionActions.startSession({ mode: 'solo', category: 'all', sessionId: 'solo:all' });
    await flush();
    expect(rpc.getRoundsFiltered).toHaveBeenCalledTimes(2);
    expectPlaying();
    expect(useSession.getState().rounds[0]?.id).toBe(100);
  });

  it('STAGED always times out into GUESSING even if prefetch never settles', async () => {
    rpc.getRoundsFiltered.mockResolvedValue(pool(10));
    image.prefetch.mockReturnValue(new Promise(() => {})); // never resolves (native hang)
    await sessionActions.startSession({ mode: 'solo', category: 'all', sessionId: 'solo:all' });
    await flush();
    await flush();
    expect(useSession.getState().phase).toBe('STAGED'); // stuck until the timeout
    vi.advanceTimersByTime(STAGED_TIMEOUT_MS);
    expect(useSession.getState().phase).toBe('GUESSING');
  });

  it('a synchronously throwing Image.prefetch does not block STAGED → GUESSING', async () => {
    rpc.getRoundsFiltered.mockResolvedValue(pool(10));
    image.prefetch.mockImplementation(() => { throw new Error('native module missing'); });
    await sessionActions.startSession({ mode: 'solo', category: 'all', sessionId: 'solo:all' });
    await flush();
    await flush();
    expect(useSession.getState().phase).toBe('GUESSING');
  });

  it('get_rounds failure → ERROR with retry, never a hang', async () => {
    rpc.getRoundsFiltered.mockRejectedValueOnce(new RpcError('rate_limited'));
    await sessionActions.startSession({ mode: 'solo', category: 'all', sessionId: 'solo:all' });
    await flush();
    const s = useSession.getState();
    expect(s.phase).toBe('ERROR');
    expect(s.error).toBe('rate_limited');
    expect(s.prevPhase).toBe('LOADING');

    rpc.getRoundsFiltered.mockResolvedValueOnce(pool(10));
    sessionActions.retry();
    await flush();
    expect(rpc.getRoundsFiltered).toHaveBeenCalledTimes(2);
    expectPlaying();
  });

  it('a non-RpcError failure (e.g. fetch TypeError) → ERROR "network" + offline', async () => {
    rpc.getRoundsFiltered.mockRejectedValueOnce(new TypeError('Network request failed'));
    await sessionActions.startSession({ mode: 'streak', category: 'cars', sessionId: 'streak:cars' });
    await flush();
    expect(useSession.getState().phase).toBe('ERROR');
    expect(useSession.getState().error).toBe('network');
    expect(useSession.getState().offline).toBe(true);
  });

  it('an empty pool → ERROR "empty_pool"', async () => {
    rpc.getRoundsFiltered.mockResolvedValueOnce([]);
    await sessionActions.startSession({ mode: 'solo', category: 'land', sessionId: 'solo:land' });
    await flush();
    expect(useSession.getState().phase).toBe('ERROR');
    expect(useSession.getState().error).toBe('empty_pool');
  });

  it('does not double-fetch the first pool', async () => {
    let resolve!: (r: Round[]) => void;
    rpc.getRoundsFiltered.mockReturnValue(new Promise<Round[]>((r) => { resolve = r; }));
    await sessionActions.startSession({ mode: 'solo', category: 'all', sessionId: 'solo:all' });
    await flush();
    expect(rpc.getRoundsFiltered).toHaveBeenCalledTimes(1);
    resolve(pool(10));
    await flush();
    expectPlaying();
    expect(rpc.getRoundsFiltered).toHaveBeenCalledTimes(1);
  });
});

describe('listing filters (get_rounds_filtered)', () => {
  const guessOnce = async (price = 50000) => {
    rpc.submitGuess.mockResolvedValueOnce({ price_eur: price, score: 800, guess_eur: price, source_url: 'https://ss.com/x' });
    sessionActions.submit(price);
    await flush();
    expect(useSession.getState().phase).toBe('REVEALING');
    sessionActions.revealDone();
    expect(useSession.getState().phase).toBe('REVEALED');
  };

  beforeEach(() => {
    vi.useFakeTimers();
    rpc.getRoundsFiltered.mockReset();
    rpc.submitGuess.mockReset();
    image.prefetch.mockReset().mockResolvedValue(true);
    sessionActions.reset();
  });
  afterEach(() => { sessionActions.reset(); vi.useRealTimers(); });

  it('passes explicit filters through and strips make/model for non-car categories', async () => {
    rpc.getRoundsFiltered.mockResolvedValue(pool(10));
    const f: ListingFilters = { period: '7d', sort: 'newest', make: 'BMW', model: 'X5' };
    await sessionActions.startSession({ mode: 'solo', category: 'cars', region: 'riga', filters: f, sessionId: 'solo:cars:riga' });
    await flush();
    expect(rpc.getRoundsFiltered).toHaveBeenLastCalledWith('cars', 'riga', f, 10, []);
    expect(useSession.getState().config?.filters).toEqual(f);

    sessionActions.reset();
    rpc.getRoundsFiltered.mockClear();
    await sessionActions.startSession({ mode: 'solo', category: 'flats', region: 'riga', filters: f, sessionId: 'solo:flats:riga' });
    await flush();
    expect(rpc.getRoundsFiltered).toHaveBeenLastCalledWith('flats', 'riga', { period: '7d', sort: 'newest' }, 10, []);
  });

  it('defaults the filters to the ones encoded in sessionId (summary play-again keeps them)', async () => {
    rpc.getRoundsFiltered.mockResolvedValue(pool(10));
    const id = encodeSessionId('streak', 'cars', 'latvia', { period: '30d', sort: 'price_asc', make: 'Škoda' });
    await sessionActions.startSession({ mode: 'streak', category: 'cars', region: 'latvia', sessionId: id, streak: 0 });
    await flush();
    expect(rpc.getRoundsFiltered).toHaveBeenCalledWith('cars', 'latvia', { period: '30d', sort: 'price_asc', make: 'Škoda' }, 10, []);
    expect(useSession.getState().config?.sessionId).toBe(id);
  });

  it('excludeIds grows across refills with every id already served', async () => {
    // First pool: 4 rounds (= REFILL_BELOW, so no top-up until one is played).
    rpc.getRoundsFiltered.mockResolvedValueOnce(pool(4)).mockResolvedValueOnce(pool(10, 100)).mockResolvedValue(pool(10, 200));
    await sessionActions.startSession({ mode: 'solo', category: 'cars', region: 'riga', filters: { period: 'all', sort: 'newest' }, sessionId: 'solo:cars:riga:x', totalRounds: 50 });
    await flush(); await flush();
    expect(useSession.getState().phase).toBe('GUESSING');
    expect(rpc.getRoundsFiltered).toHaveBeenCalledTimes(1);
    expect(rpc.getRoundsFiltered.mock.calls[0][4]).toEqual([]);

    // One round played → 3 left < REFILL_BELOW → second fetch excludes the whole first pool.
    await guessOnce();
    sessionActions.next();
    await flush(); await flush();
    expect(rpc.getRoundsFiltered).toHaveBeenCalledTimes(2);
    expect(rpc.getRoundsFiltered.mock.calls[1][4]).toEqual([1, 2, 3, 4]);
    expect(useSession.getState().rounds.map((r) => r.id)).toEqual([2, 3, 4, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109]);

    // Keep playing until the queue drops below the threshold again → third fetch excludes everything served so far.
    for (let i = 0; i < 12 && rpc.getRoundsFiltered.mock.calls.length < 3; i++) {
      await guessOnce();
      sessionActions.next();
      await flush(); await flush();
    }
    expect(rpc.getRoundsFiltered).toHaveBeenCalledTimes(3);
    expect(rpc.getRoundsFiltered.mock.calls[2][4]).toEqual([1, 2, 3, 4, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109]);
    expect(rpc.getRoundsFiltered.mock.calls[2][2]).toEqual({ period: 'all', sort: 'newest' });
    expect(useSession.getState().outcomes.length).toBeGreaterThan(1);
  });

  it('a filtered pool that runs dry mid-session ends on SUMMARY (never a hang or an error)', async () => {
    // Only 2 listings match: the first pool has 2 rounds, every refill is empty.
    rpc.getRoundsFiltered.mockResolvedValueOnce(pool(2)).mockResolvedValue([]);
    await sessionActions.startSession({ mode: 'solo', category: 'cars', region: 'riga', filters: { period: '24h', sort: 'random', make: 'Saab' }, sessionId: 'solo:cars:riga:y' });
    await flush(); await flush();
    expect(useSession.getState().phase).toBe('GUESSING');

    await guessOnce();
    sessionActions.next();
    await flush(); await flush();
    expect(useSession.getState().phase).toBe('GUESSING');
    expect(useSession.getState().rounds[0]?.id).toBe(2);

    await guessOnce();
    sessionActions.next(); // queue exhausted → LOADING → empty refill → SUMMARY
    await flush(); await flush();
    const st = useSession.getState();
    expect(st.phase).toBe('SUMMARY');
    expect(st.outcomes).toHaveLength(2);
    expect(st.error).toBeNull();
  });

  it('an empty first pool with filters is still ERROR empty_pool (home shows "adjust filters")', async () => {
    rpc.getRoundsFiltered.mockResolvedValue([]);
    await sessionActions.startSession({ mode: 'solo', category: 'cars', region: 'riga', filters: { period: '24h', sort: 'random', make: 'Saab' }, sessionId: 'solo:cars:riga:z' });
    await flush();
    expect(useSession.getState().phase).toBe('ERROR');
    expect(useSession.getState().error).toBe('empty_pool');
  });
});

describe('photosUnavailable (dead photos: CDN serves a 1×1 GIF)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    rpc.getRoundsFiltered.mockReset();
    rpc.getDaily.mockReset();
    image.prefetch.mockReset().mockResolvedValue(true);
    sessionActions.reset();
  });
  afterEach(() => { sessionActions.reset(); vi.useRealTimers(); });

  it('solo: discards the round without consuming a skip, scoring, or advancing roundNo', async () => {
    rpc.getRoundsFiltered.mockResolvedValue(pool(10));
    await sessionActions.startSession({ mode: 'solo', category: 'flats', sessionId: 'solo:flats' });
    await flush(); await flush();
    expect(useSession.getState().phase).toBe('GUESSING');
    expect(useSession.getState().rounds[0]?.id).toBe(1);

    sessionActions.photosUnavailable();
    await flush(); await flush();
    const s = useSession.getState();
    expect(s.rounds[0]?.id).toBe(2);
    expect(s.skipsUsed).toBe(0);
    expect(s.roundNo).toBe(1);
    expect(s.outcomes).toHaveLength(0);
    expect(s.phase).toBe('GUESSING'); // the next round staged and its prefetch resolved
  });

  it('streak: keeps the streak counter and refills the pool once it runs low', async () => {
    rpc.getRoundsFiltered.mockResolvedValueOnce(pool(4)).mockResolvedValue(pool(10, 100));
    await sessionActions.startSession({ mode: 'streak', category: 'cars', sessionId: 'streak:cars', streak: 7 });
    await flush(); await flush();
    expect(useSession.getState().streak).toBe(7);

    sessionActions.photosUnavailable();
    await flush(); await flush();
    const s = useSession.getState();
    expect(s.rounds[0]?.id).toBe(2);
    expect(s.streak).toBe(7);
    expect(s.streakOver).toBe(false);
    expect(s.skipsUsed).toBe(0);
    expect(rpc.getRoundsFiltered).toHaveBeenCalledTimes(2); // 3 left < REFILL_BELOW → topped up
    expect(s.rounds.some((r) => r.id === 100)).toBe(true);
  });

  it('daily (fixed set): the round stays; the carousel shows the placeholder instead', async () => {
    rpc.getDaily.mockResolvedValue({ day: '2026-10-01', number: 37, rounds: pool(5), already_played: false, result: null });
    await sessionActions.startSession({ mode: 'daily', sessionId: 'daily' });
    await flush(); await flush();
    expectPlaying();
    expect(useSession.getState().rounds[0]?.id).toBe(1);

    sessionActions.photosUnavailable();
    await flush();
    const s = useSession.getState();
    expect(s.rounds[0]?.id).toBe(1);
    expect(s.rounds).toHaveLength(5);
    expectPlaying();
  });

  it('practice (bundled pool): never discards the last round into an unfillable LOADING', async () => {
    await sessionActions.startSession({ mode: 'solo', category: 'all', sessionId: 'onboarding', rounds: pool(2), localScoring: true, totalRounds: 2 });
    await flush(); await flush();
    sessionActions.photosUnavailable(); // 2 left → drop one
    await flush(); await flush();
    expect(useSession.getState().rounds.map((r) => r.id)).toEqual([2]);
    sessionActions.photosUnavailable(); // last one: keep it with the placeholder
    await flush();
    expect(useSession.getState().rounds.map((r) => r.id)).toEqual([2]);
    expectPlaying();
    expect(rpc.getRoundsFiltered).not.toHaveBeenCalled();
  });

  it('is a no-op outside STAGED/GUESSING (e.g. while a guess is being submitted)', async () => {
    rpc.getRoundsFiltered.mockResolvedValue(pool(10));
    rpc.submitGuess.mockReturnValue(new Promise(() => {}));
    await sessionActions.startSession({ mode: 'solo', category: 'all', sessionId: 'solo:all' });
    await flush(); await flush();
    sessionActions.submit(50000);
    expect(useSession.getState().phase).toBe('SUBMITTING');
    sessionActions.photosUnavailable();
    expect(useSession.getState().phase).toBe('SUBMITTING');
    expect(useSession.getState().rounds[0]?.id).toBe(1);
  });
});
