/**
 * Onboarding flow rules (src/game/onboarding.ts):
 *  - `onboarded` is persisted BEFORE the practice session starts (killing the
 *    app mid-practice must not restart onboarding)
 *  - practice plays real listings from get_offline_pack (with price_eur, no
 *    tokens), scored locally; the bundled set is only the fallback when the
 *    RPC fails / times out / returns fewer than PRACTICE_ROUNDS usable rounds
 *  - a restored account with a username skips practice (store flag consumed)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => [] as string[]);
const storage = vi.hoisted(() => ({ setOnboarded: vi.fn(async () => { calls.push('setOnboarded'); }) }));
const session = vi.hoisted(() => ({ sessionActions: { startSession: vi.fn(async (_o: unknown) => { calls.push('startSession'); }) } }));
const rpc = vi.hoisted(() => ({ getOfflinePack: vi.fn(), submitGuess: vi.fn() }));
const env = vi.hoisted(() => ({ isConfigured: true }));
const auth = vi.hoisted(() => {
  const state = { justRestored: false, hasUsername: false, clearJustRestored: vi.fn(() => { state.justRestored = false; }) };
  return { useAuth: { getState: () => state }, state };
});

vi.mock('./storage', () => storage);
vi.mock('./session', () => session);
vi.mock('../api/rpc', () => rpc);
vi.mock('../env', () => env);
vi.mock('../auth/store', () => ({ useAuth: auth.useAuth }));
vi.mock('../analytics', () => ({ track: vi.fn() }));

import { ONBOARDING_SET, type OfflineRound } from './onboardingSet';
import { PRACTICE_FETCH_TIMEOUT_MS, PRACTICE_ROUNDS, loadPracticeRounds, markOnboarded, nextAfterLink, startPracticeSession } from './onboarding';

const packRound = (id: number, price = 50_000): OfflineRound => ({
  id, category: 'flats', region: 'riga', location: 'Teika', attributes: { m2: 50, rooms: 2 }, title_hint: null,
  photo_urls: [`https://i.ss.com/${id}.800.jpg`], source: 'SS.com', source_url: `https://www.ss.com/msg/${id}`, token: '', price_eur: price,
});
const pack = (n: number) => Array.from({ length: n }, (_, i) => packRound(100 + i));

beforeEach(() => {
  calls.length = 0; storage.setOnboarded.mockClear(); session.sessionActions.startSession.mockClear();
  rpc.getOfflinePack.mockReset(); env.isConfigured = true; auth.state.justRestored = false;
});
afterEach(() => { vi.useRealTimers(); });

describe('startPracticeSession', () => {
  it('persists onboarded first, then starts a locally scored session with the offline pack (real listings with prices)', async () => {
    rpc.getOfflinePack.mockResolvedValueOnce(pack(3));
    await startPracticeSession();
    expect(calls).toEqual(['setOnboarded', 'startSession']);
    expect(storage.setOnboarded).toHaveBeenCalledWith(true);
    expect(rpc.getOfflinePack).toHaveBeenCalledWith('all', PRACTICE_ROUNDS);
    expect(session.sessionActions.startSession).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'solo', sessionId: 'onboarding', localScoring: true, totalRounds: PRACTICE_ROUNDS,
    }));
    const { rounds } = session.sessionActions.startSession.mock.calls[0]![0] as { rounds: OfflineRound[] };
    expect(rounds.map((r) => r.id)).toEqual([100, 101, 102]);
    expect(rounds.every((r) => r.price_eur > 0 && r.photo_urls.length === 1)).toBe(true);
    expect(rpc.submitGuess).not.toHaveBeenCalled();
    expect(PRACTICE_ROUNDS).toBe(3);
  });

  it('falls back to the bundled set when the RPC fails', async () => {
    rpc.getOfflinePack.mockRejectedValueOnce(new TypeError('Network request failed'));
    await startPracticeSession();
    expect(calls).toEqual(['setOnboarded', 'startSession']);
    expect(session.sessionActions.startSession).toHaveBeenCalledWith(expect.objectContaining({ rounds: ONBOARDING_SET, localScoring: true }));
  });

  it('markOnboarded alone (skip / straight home) persists the flag', async () => {
    await markOnboarded();
    expect(storage.setOnboarded).toHaveBeenCalledWith(true);
  });
});

describe('loadPracticeRounds', () => {
  it('takes exactly PRACTICE_ROUNDS usable rounds from a larger pack', async () => {
    rpc.getOfflinePack.mockResolvedValueOnce(pack(5));
    const rounds = await loadPracticeRounds();
    expect(rounds).toHaveLength(PRACTICE_ROUNDS);
    expect(rounds.map((r) => r.id)).toEqual([100, 101, 102]);
  });

  it('falls back when fewer than PRACTICE_ROUNDS rounds come back', async () => {
    rpc.getOfflinePack.mockResolvedValueOnce(pack(2));
    expect(await loadPracticeRounds()).toBe(ONBOARDING_SET);
  });

  it('ignores rounds without a positive price (nothing to score against locally)', async () => {
    rpc.getOfflinePack.mockResolvedValueOnce([packRound(1, 0), packRound(2), { ...packRound(3), price_eur: undefined as unknown as number }, packRound(4)]);
    expect(await loadPracticeRounds()).toBe(ONBOARDING_SET);
    rpc.getOfflinePack.mockResolvedValueOnce([packRound(1, 0), packRound(2), packRound(3), packRound(4)]);
    expect((await loadPracticeRounds()).map((r) => r.id)).toEqual([2, 3, 4]);
  });

  it('falls back on a malformed response and when the env is not configured', async () => {
    rpc.getOfflinePack.mockResolvedValueOnce(null);
    expect(await loadPracticeRounds()).toBe(ONBOARDING_SET);
    env.isConfigured = false;
    rpc.getOfflinePack.mockClear();
    expect(await loadPracticeRounds()).toBe(ONBOARDING_SET);
    expect(rpc.getOfflinePack).not.toHaveBeenCalled();
  });

  it('falls back when the RPC does not answer in time', async () => {
    vi.useFakeTimers();
    rpc.getOfflinePack.mockReturnValueOnce(new Promise(() => { /* never settles */ }));
    const p = loadPracticeRounds();
    await vi.advanceTimersByTimeAsync(PRACTICE_FETCH_TIMEOUT_MS);
    expect(await p).toBe(ONBOARDING_SET);
  });
});

describe('nextAfterLink', () => {
  it('restored account with a username → home; the flag is consumed', () => {
    auth.state.justRestored = true;
    expect(nextAfterLink('restored')).toBe('home');
    expect(auth.state.clearJustRestored).toHaveBeenCalled();
    expect(auth.state.justRestored).toBe(false);
    expect(nextAfterLink('restored')).toBe('practice'); // flag already consumed
  });

  it('linked / unchanged / restored-without-username → practice', () => {
    expect(nextAfterLink('linked')).toBe('practice');
    expect(nextAfterLink('unchanged')).toBe('practice');
    auth.state.justRestored = false;
    expect(nextAfterLink('restored')).toBe('practice');
  });
});
