/**
 * Session store vs. auth changes and stale tokens (TestFlight build 24: linking
 * Apple/Google during the practice rounds changed auth.uid(); the rounds had
 * been issued to the anonymous user, submit_guess raised bad_token and the
 * round screen went blank for good).
 *  - auth user changes mid-session → unplayed rounds are re-fetched, score kept
 *  - bad_token / token_expired on submit → round discarded, pool re-issued,
 *    and the next round reaches GUESSING (the old raw setState left STAGED dead)
 *  - locally scored (onboarding) sessions never touch the server
 *  - LOADING never hangs: watchdog → ERROR, a late pool still recovers
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Round } from '../api/types';

(globalThis as { __DEV__?: boolean }).__DEV__ = false;

const rpc = vi.hoisted(() => ({ getRounds: vi.fn(), getDaily: vi.fn(), submitGuess: vi.fn(), submitDaily: vi.fn() }));
const image = vi.hoisted(() => ({ prefetch: vi.fn() }));
const track = vi.hoisted(() => vi.fn());

/** Minimal zustand-like auth store: getState / setState / subscribe. */
const auth = vi.hoisted(() => {
  type S = { session: { user: { id: string } } | null; hasUsername: boolean };
  let state: S = { session: null, hasUsername: false };
  const listeners = new Set<(s: S, p: S) => void>();
  return {
    getState: () => state,
    setState: (patch: Partial<S>) => { const prev = state; state = { ...state, ...patch }; for (const l of listeners) l(state, prev); },
    subscribe: (l: (s: S, p: S) => void) => { listeners.add(l); return () => listeners.delete(l); },
    signInAs: (id: string) => auth.setState({ session: { user: { id } } }),
  };
});

vi.mock('expo-image', () => ({ Image: image }));
vi.mock('../api/rpc', () => ({
  ...rpc,
  RpcError: class RpcError extends Error { constructor(public code: string, public hint?: string) { super(code); } },
}));
vi.mock('../auth/store', () => ({ useAuth: auth }));
vi.mock('../env', () => ({ isConfigured: true, env: {} }));
vi.mock('../analytics', () => ({ track }));
/** Per-user local state keyed by the auth uid (as src/game/storage does): hint tokens + streak bests. */
const userState = vi.hoisted(() => ({
  hints: {} as Record<string, number>,
  bests: {} as Record<string, Record<string, number>>,
  uid: () => auth.getState().session?.user.id ?? 'nouser',
}));
vi.mock('./storage', () => ({
  bumpDailyStreak: vi.fn(async () => 1), getDailyProgress: vi.fn(async () => null),
  getHintTokens: vi.fn(async () => userState.hints[userState.uid()] ?? 0),
  getStreakBests: vi.fn(async () => userState.bests[userState.uid()] ?? {}),
  recordStreakBest: vi.fn(async (category: string, length: number) => {
    const b = (userState.bests[userState.uid()] ??= {});
    b[category] = Math.max(b[category] ?? 0, length);
    return b[category];
  }),
  setDailyLocalResult: vi.fn(async () => {}), setDailyProgress: vi.fn(async () => {}),
  setHintTokens: vi.fn(async (n: number) => { userState.hints[userState.uid()] = n; }), setStreakCurrent: vi.fn(async () => {}),
}));

import { RpcError } from '../api/rpc';
import { LOADING_TIMEOUT_MS } from './machine';
import { ONBOARDING_SET } from './onboardingSet';
import { sessionActions, useSession } from './session';

const round = (id: number, token = `tok-${id}`): Round => ({
  id, category: 'flats', region: 'riga', location: 'Purvciems', attributes: { m2: 65, rooms: 3 },
  title_hint: null, photo_urls: [`https://i.ss.com/${id}.800.jpg`], source: 'ss.com', source_url: 'https://ss.com/x', token,
});
const pool = (n: number, from = 1) => Array.from({ length: n }, (_, i) => round(from + i));
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const st = () => useSession.getState();

/** Start a solo session as `uid`, wait until the first round is GUESSING. */
async function startSolo(uid = 'anon-1') {
  auth.signInAs(uid);
  rpc.getRounds.mockResolvedValueOnce(pool(10));
  await sessionActions.startSession({ mode: 'solo', category: 'all', sessionId: 'solo:all' });
  await flush(); await flush();
  expect(st().phase).toBe('GUESSING');
}

/** Play the current round to REVEALED with a server score. */
async function playCurrent(guess: number, price: number, score: number) {
  rpc.submitGuess.mockResolvedValueOnce({ price_eur: price, score, guess_eur: guess, source_url: 'https://ss.com/x' });
  sessionActions.submit(guess);
  await flush();
  expect(st().phase).toBe('REVEALING');
  sessionActions.revealDone();
  expect(st().phase).toBe('REVEALED');
}

beforeEach(() => {
  vi.useFakeTimers();
  rpc.getRounds.mockReset(); rpc.getDaily.mockReset(); rpc.submitGuess.mockReset();
  image.prefetch.mockReset().mockResolvedValue(true);
  track.mockReset();
  userState.hints = {}; userState.bests = {};
  auth.setState({ session: null, hasUsername: false });
  sessionActions.reset();
});
afterEach(() => { sessionActions.reset(); vi.useRealTimers(); });

describe('auth user changes while a session is live', () => {
  it('re-fetches the unplayed rounds for the new user, keeping score and round number', async () => {
    await startSolo('anon-1');
    await playCurrent(72000, 78500, 516);
    sessionActions.next();
    await flush(); await flush();
    expect(st().phase).toBe('GUESSING');
    expect(st().roundNo).toBe(2);
    expect(st().rounds[0].id).toBe(2);
    expect(sessionActions.poolOwner()).toBe('anon-1');

    // Apple / Google link: signInWithIdToken → new auth.uid()
    rpc.getRounds.mockResolvedValueOnce(pool(10, 100));
    auth.signInAs('apple-user');
    await flush(); await flush();

    expect(rpc.getRounds).toHaveBeenCalledTimes(2);
    expect(sessionActions.poolOwner()).toBe('apple-user');
    expect(st().phase).toBe('GUESSING');
    expect(st().rounds[0].id).toBe(100);
    expect(st().rounds.every((r) => r.id >= 100)).toBe(true);
    expect(st().roundNo).toBe(2);
    expect(st().outcomes).toHaveLength(1);
    expect(st().outcomes[0].score).toBe(516);
    expect(track).toHaveBeenCalledWith('rounds_reissued', expect.objectContaining({ reason: 'auth_change' }));

    // and the next submit uses a token of the new pool
    rpc.submitGuess.mockResolvedValueOnce({ price_eur: 1000, score: 900, guess_eur: 1000, source_url: '' });
    sessionActions.submit(1000);
    await flush();
    expect(rpc.submitGuess).toHaveBeenLastCalledWith('tok-100', 1000, expect.any(Number));
  });

  it('while REVEALED: the revealed round stays on screen, the queue behind it is re-issued', async () => {
    await startSolo('anon-1');
    await playCurrent(72000, 78500, 516);
    rpc.getRounds.mockResolvedValueOnce(pool(10, 100));
    auth.signInAs('google-user');
    await flush(); await flush();
    expect(st().phase).toBe('REVEALED');
    expect(st().lastOutcome?.round.id).toBe(1);
    expect(st().rounds[0].id).toBe(1);
    expect(st().rounds[1].id).toBe(100);
    sessionActions.next();
    await flush(); await flush();
    expect(st().phase).toBe('GUESSING');
    expect(st().rounds[0].id).toBe(100);
  });

  it('a token refresh for the same user does not re-fetch', async () => {
    await startSolo('anon-1');
    auth.setState({ session: { user: { id: 'anon-1' } } });
    await flush();
    expect(rpc.getRounds).toHaveBeenCalledTimes(1);
  });

  it('a pool that was in flight for the previous user is dropped and fetched again', async () => {
    auth.signInAs('anon-1');
    let resolve!: (r: Round[]) => void;
    rpc.getRounds.mockReturnValueOnce(new Promise<Round[]>((r) => { resolve = r; }));
    await sessionActions.startSession({ mode: 'solo', category: 'all', sessionId: 'solo:all' });
    await flush();
    auth.signInAs('apple-user');
    rpc.getRounds.mockResolvedValueOnce(pool(10, 100));
    resolve(pool(10)); // stale: issued to anon-1
    await flush(); await flush(); await flush();
    expect(rpc.getRounds).toHaveBeenCalledTimes(2);
    expect(st().rounds[0]?.id).toBe(100);
    expect(sessionActions.poolOwner()).toBe('apple-user');
  });

  it('locally scored sessions (onboarding practice) never call the server, before or after the auth change', async () => {
    auth.signInAs('anon-1');
    await sessionActions.startSession({ mode: 'solo', category: 'all', rounds: ONBOARDING_SET, totalRounds: 3, sessionId: 'onboarding', localScoring: true });
    await flush(); await flush();
    expect(st().phase).toBe('GUESSING');
    auth.signInAs('apple-user');
    await flush(); await flush();
    expect(rpc.getRounds).not.toHaveBeenCalled();
    expect(st().phase).toBe('GUESSING');
    expect(st().rounds[0].id).toBe(ONBOARDING_SET[0].id);
    sessionActions.submit(80_000);
    await flush();
    expect(rpc.submitGuess).not.toHaveBeenCalled();
    expect(st().phase).toBe('REVEALING');
    expect(st().lastOutcome?.price).toBe(ONBOARDING_SET[0].price_eur);
  });

  it('re-reads the per-user local state (hint tokens, streak best) for the new user', async () => {
    userState.hints['anon-1'] = 2;
    userState.bests['anon-1'] = { all: 7 };
    auth.signInAs('anon-1');
    rpc.getRounds.mockResolvedValueOnce(pool(10));
    await sessionActions.startSession({ mode: 'streak', category: 'all', sessionId: 'streak:all', streak: 0 });
    useSession.setState({ streakBest: 7 }); // the round screen seeds it from getStreakBests()
    await flush(); await flush();
    expect(st().hintTokens).toBe(2);
    expect(st().streakBest).toBe(7);

    // restore a different account: its own (empty) local state, never anon-1's
    rpc.getRounds.mockResolvedValueOnce(pool(10, 100));
    auth.signInAs('apple-user');
    await flush(); await flush();
    expect(st().hintTokens).toBe(0);
    expect(st().streakBest).toBe(0);
    expect(sessionActions.poolOwner()).toBe('apple-user');

    // and the values of a user with local state come back when switching to it
    userState.hints['google-user'] = 1;
    userState.bests['google-user'] = { all: 3 };
    rpc.getRounds.mockResolvedValueOnce(pool(10, 200));
    auth.signInAs('google-user');
    await flush(); await flush();
    expect(st().hintTokens).toBe(1);
    expect(st().streakBest).toBe(3);
  });

  it('a spent hint token is written for the current user only', async () => {
    userState.hints['anon-1'] = 2;
    await startSolo('anon-1');
    expect(await sessionActions.spendHintToken()).toBe(true);
    expect(userState.hints['anon-1']).toBe(1);
    expect(st().hintTokens).toBe(1);
    rpc.getRounds.mockResolvedValueOnce(pool(10, 100));
    auth.signInAs('apple-user');
    await flush(); await flush();
    expect(st().hintTokens).toBe(0);
    expect(await sessionActions.spendHintToken()).toBe(false);
    expect(userState.hints['anon-1']).toBe(1);
    expect(userState.hints['apple-user']).toBeUndefined();
  });

  it('daily: remaining rounds are swapped for their re-tokenised twins', async () => {
    auth.signInAs('anon-1');
    const rounds = pool(5);
    rpc.getDaily.mockResolvedValueOnce({ day: '2026-09-27', number: 40, rounds, already_played: false, result: null });
    await sessionActions.startSession({ mode: 'daily', sessionId: 'daily' });
    await flush(); await flush(); await flush();
    expect(st().phase).toBe('GUESSING');
    await playCurrent(72000, 78500, 516);
    sessionActions.next();
    await flush(); await flush();
    expect(st().rounds[0].token).toBe('tok-2');

    rpc.getDaily.mockResolvedValueOnce({ day: '2026-09-27', number: 40, rounds: rounds.map((r) => round(r.id, `new-${r.id}`)), already_played: false, result: null });
    auth.signInAs('apple-user');
    await flush(); await flush(); await flush();
    expect(st().phase).toBe('GUESSING');
    expect(st().roundNo).toBe(2);
    expect(st().rounds.map((r) => r.token)).toEqual(['new-2', 'new-3', 'new-4', 'new-5']);
    expect(st().outcomes).toHaveLength(1);
  });
});

describe('stale tokens on submit', () => {
  it('bad_token: the round is discarded, the pool re-issued and the next round reaches GUESSING', async () => {
    await startSolo('anon-1');
    rpc.submitGuess.mockRejectedValueOnce(new RpcError('bad_token'));
    rpc.getRounds.mockResolvedValueOnce(pool(10, 100));
    sessionActions.submit(50_000);
    await flush(); await flush(); await flush();
    expect(st().phase).toBe('GUESSING'); // not stuck in STAGED with a dead keypad
    expect(st().rounds[0].id).toBe(100);
    expect(st().roundNo).toBe(1);
    expect(st().skipsUsed).toBe(0);
    expect(st().outcomes).toHaveLength(0);
    expect(track).toHaveBeenCalledWith('rounds_reissued', expect.objectContaining({ reason: 'bad_token' }));
  });

  it('token_expired with the re-fetch failing still leaves a playable round (the rest of the old queue)', async () => {
    await startSolo('anon-1');
    rpc.submitGuess.mockRejectedValueOnce(new RpcError('token_expired'));
    rpc.getRounds.mockRejectedValueOnce(new TypeError('Network request failed'));
    sessionActions.submit(50_000);
    await flush(); await flush(); await flush();
    expect(st().phase).toBe('GUESSING');
    expect(st().rounds[0].id).toBe(2);
  });

  it('a pre-supplied server pool that runs dry is refilled instead of hanging in LOADING', async () => {
    auth.signInAs('anon-1');
    await sessionActions.startSession({ mode: 'solo', category: 'all', rounds: [round(1)], totalRounds: 3, sessionId: 'solo:all' });
    await flush(); await flush();
    expect(st().phase).toBe('GUESSING');
    expect(rpc.getRounds).not.toHaveBeenCalled(); // no proactive top-up of a supplied pool
    rpc.getRounds.mockResolvedValueOnce(pool(10, 100));
    await playCurrent(1, 1, 1000);
    sessionActions.next();
    await flush(); await flush(); await flush();
    expect(rpc.getRounds).toHaveBeenCalledTimes(1);
    expect(st().phase).toBe('GUESSING');
    expect(st().rounds[0].id).toBe(100);
    expect(st().roundNo).toBe(2);
  });
});

describe('LOADING watchdog', () => {
  it('surfaces ERROR (timeout) when the pool never arrives, and a late pool still recovers', async () => {
    auth.signInAs('anon-1');
    let resolve!: (r: Round[]) => void;
    rpc.getRounds.mockReturnValueOnce(new Promise<Round[]>((r) => { resolve = r; }));
    await sessionActions.startSession({ mode: 'solo', category: 'all', sessionId: 'solo:all' });
    await flush();
    expect(st().phase).toBe('LOADING');
    vi.advanceTimersByTime(LOADING_TIMEOUT_MS);
    expect(st().phase).toBe('ERROR');
    expect(st().error).toBe('timeout');
    expect(st().prevPhase).toBe('LOADING');
    resolve(pool(10));
    await flush(); await flush();
    expect(['STAGED', 'GUESSING']).toContain(st().phase);
    expect(st().error).toBeNull();
  });

  it('a locally scored pool that runs dry ends in ERROR with retry, not a silent skeleton', async () => {
    await sessionActions.startSession({ mode: 'solo', category: 'all', rounds: [ONBOARDING_SET[0]], totalRounds: 3, sessionId: 'onboarding', localScoring: true });
    await flush(); await flush();
    sessionActions.submit(1000);
    await flush();
    sessionActions.revealDone();
    sessionActions.next();
    expect(st().phase).toBe('LOADING');
    vi.advanceTimersByTime(LOADING_TIMEOUT_MS);
    expect(st().phase).toBe('ERROR');
    expect(rpc.getRounds).not.toHaveBeenCalled();
  });

  it('recover() nudges every stuck state: STAGED → GUESSING, reveal without outcome → next round', async () => {
    await startSolo('anon-1');
    useSession.setState({ phase: 'STAGED' });
    sessionActions.recover();
    expect(st().phase).toBe('GUESSING');
    useSession.setState({ phase: 'REVEALED', lastOutcome: null });
    sessionActions.recover();
    await flush(); await flush();
    expect(st().phase).toBe('GUESSING');
    expect(st().rounds[0].id).toBe(2);
  });
});
