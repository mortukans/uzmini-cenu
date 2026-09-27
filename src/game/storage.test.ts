/**
 * src/game/storage: per-user scoping of the local game state (build 25: a
 * restored / re-created account saw the previous user's daily result, streak
 * bests and hint tokens on the same device).
 *  - per-user keys are derived from the current auth user id
 *  - a uid switch reads the new user's values (defaults for a fresh account),
 *    and switching back finds the first user's values untouched
 *  - `onboarded` / prefs stay device-global
 *  - clearAll wipes the current user's keys + device flags, nobody else's
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mem = vi.hoisted(() => new Map<string, string>());
const auth = vi.hoisted(() => {
  const state: { session: { user: { id: string } } | null } = { session: null };
  return { useAuth: { getState: () => state }, signInAs: (id: string | null) => { state.session = id ? { user: { id } } : null; } };
});

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => mem.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => { mem.set(k, v); }),
    multiRemove: vi.fn(async (keys: string[]) => { for (const k of keys) mem.delete(k); }),
  },
}));
vi.mock('../auth/store', () => ({ useAuth: auth.useAuth }));

import {
  NO_USER_SCOPE, bumpDailyStreak, clearAll, clearUser, getDailyLocalResult, getDailyProgress, getDailyStreak, getHintTokens,
  getInterstitialLastShown, getPrefs, getStreakBests, getStreakCurrent, isOnboarded, recordStreakBest, setDailyLocalResult,
  setDailyProgress, setHintTokens, setInterstitialLastShown, setOnboarded, setPrefs, setStreakCurrent, storageUid, userKey, userKeysOf,
} from './storage';

const result = (day: string, total: number) => ({ day, number: 40, total, grid: '🟩🟩🟨🟥🟩', outcomes: [], synced: false });

beforeEach(() => { mem.clear(); auth.signInAs(null); });

describe('per-user key derivation', () => {
  it('prefixes every per-user key with the current auth user id', () => {
    auth.signInAs('anon-1');
    expect(storageUid()).toBe('anon-1');
    expect(userKey('uc.hint.tokens')).toBe('u:anon-1:uc.hint.tokens');
    expect(userKey('uc.daily.local', 'apple-user')).toBe('u:apple-user:uc.daily.local');
    for (const k of userKeysOf()) expect(k.startsWith('u:anon-1:uc.')).toBe(true);
    expect(userKeysOf()).toEqual(expect.arrayContaining([
      'u:anon-1:uc.daily.progress', 'u:anon-1:uc.daily.local', 'u:anon-1:uc.daily.streak',
      'u:anon-1:uc.streak.best', 'u:anon-1:uc.streak.current', 'u:anon-1:uc.hint.tokens', 'u:anon-1:uc.ads.last',
    ]));
  });

  it('falls back to a fixed scope while no session exists', () => {
    expect(storageUid()).toBe(NO_USER_SCOPE);
    expect(userKey('uc.hint.tokens')).toBe(`u:${NO_USER_SCOPE}:uc.hint.tokens`);
  });

  it('writes land under the uid-prefixed key', async () => {
    auth.signInAs('anon-1');
    await setHintTokens(2);
    await setDailyLocalResult(result('2026-09-27', 3210));
    expect(mem.get('u:anon-1:uc.hint.tokens')).toBe('2');
    expect(JSON.parse(mem.get('u:anon-1:uc.daily.local')!)).toMatchObject({ total: 3210 });
    expect([...mem.keys()].some((k) => k === 'uc.hint.tokens' || k === 'uc.daily.local')).toBe(false);
  });
});

describe('switching the auth user', () => {
  it('daily result / progress / streak, streak bests and hint tokens are the new user\'s, not the previous one\'s', async () => {
    auth.signInAs('anon-1');
    await setDailyLocalResult(result('2026-09-27', 0));
    await setDailyProgress({ day: '2026-09-27', number: 40, outcomes: [] });
    await bumpDailyStreak('2026-09-27', '2026-09-26');
    await recordStreakBest('flats', 7);
    await setStreakCurrent({ category: 'flats', region: 'riga', length: 3, sessionId: 'streak:flats:riga' });
    await setHintTokens(2);
    await setInterstitialLastShown(1234);

    // restore a different account (or delete + fresh anonymous account)
    auth.signInAs('apple-user');
    expect(await getDailyLocalResult()).toBeNull();
    expect(await getDailyProgress()).toBeNull();
    expect(await getDailyStreak()).toBeNull();
    expect(await getStreakBests()).toEqual({});
    expect(await getStreakCurrent()).toBeNull();
    expect(await getHintTokens()).toBe(0);
    expect(await getInterstitialLastShown()).toBe(0);

    // the new user's own writes do not touch the first user's values
    await setHintTokens(5);
    await recordStreakBest('flats', 1);
    auth.signInAs('anon-1');
    expect((await getDailyLocalResult())?.total).toBe(0);
    expect((await getDailyStreak())?.days).toBe(1);
    expect(await getStreakBests()).toEqual({ flats: 7 });
    expect(await getHintTokens()).toBe(2);
    auth.signInAs('apple-user');
    expect(await getHintTokens()).toBe(5);
    expect(await getStreakBests()).toEqual({ flats: 1 });
  });

  it('`onboarded` and prefs stay device-global', async () => {
    auth.signInAs('anon-1');
    await setOnboarded(true);
    await setPrefs({ category: 'cars', lang: 'ru' });
    auth.signInAs('apple-user');
    expect(await isOnboarded()).toBe(true);
    expect(await getPrefs()).toMatchObject({ category: 'cars', lang: 'ru' });
    expect(mem.has('uc.onboarded')).toBe(true);
    expect(mem.has('uc.prefs')).toBe(true);
  });
});

describe('clearing', () => {
  it('clearUser removes only that user\'s keys', async () => {
    auth.signInAs('anon-1'); await setHintTokens(2); await setOnboarded(true);
    auth.signInAs('apple-user'); await setHintTokens(5);
    await clearUser();
    expect(await getHintTokens()).toBe(0);
    expect(await isOnboarded()).toBe(true);
    auth.signInAs('anon-1');
    expect(await getHintTokens()).toBe(2);
  });

  it('clearAll (delete account) wipes the current user\'s keys and the device flags, not other users', async () => {
    auth.signInAs('other-user'); await setHintTokens(9);
    auth.signInAs('anon-1'); await setHintTokens(2); await setDailyLocalResult(result('2026-09-27', 100)); await setOnboarded(true);
    await clearAll();
    expect(await getHintTokens()).toBe(0);
    expect(await getDailyLocalResult()).toBeNull();
    expect(await isOnboarded()).toBe(false);
    auth.signInAs('other-user');
    expect(await getHintTokens()).toBe(9);
  });
});
