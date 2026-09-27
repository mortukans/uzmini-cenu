/**
 * Small typed wrapper over AsyncStorage for local game state: onboarding flag,
 * preferences, streak bests, hint tokens, daily progress / local results.
 *
 * Scoping (build 25 regression: a restored / re-created account still saw the
 * previous user's daily result, streak bests and hint tokens on this device):
 *  - DEVICE keys (`onboarded`, `prefs`) are global.
 *  - Every per-user key is prefixed with the current auth user id
 *    (`u:<uid>:uc.…`), read at call time from useAuth, so switching accounts
 *    (link / restore / sign-out / delete) never leaks state between users.
 *    Screens re-read on uid change (they subscribe to useAuth) — see
 *    app/(tabs)/index.tsx, app/(tabs)/daily.tsx and src/game/session.ts.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CategoryFilter, Region } from '../api/types';
import { useAuth } from '../auth/store';
import type { HintType } from './hints';

/** Device-global keys. */
const DEVICE_KEYS = {
  onboarded: 'uc.onboarded',
  prefs: 'uc.prefs',
} as const;

/** Per-user keys: stored under `userKey(base)`. */
const USER_KEYS = {
  streakBest: 'uc.streak.best',
  streakCurrent: 'uc.streak.current',
  hintTokens: 'uc.hint.tokens',
  rewardedHints: 'uc.hint.rewarded', // { day, count }
  dailyProgress: 'uc.daily.progress',
  dailyLocalResult: 'uc.daily.local', // anonymous result, keyed by day
  dailyStreak: 'uc.daily.streak', // { lastDay, days }
  interstitialLastShown: 'uc.ads.last',
} as const;

/** Scope used while no auth session exists (unconfigured env, bootstrap not done). */
export const NO_USER_SCOPE = 'nouser';

/** auth.uid() the per-user keys are scoped to right now. */
export const storageUid = (): string => useAuth.getState().session?.user.id ?? NO_USER_SCOPE;

/** `u:<uid>:<base>` — the AsyncStorage key of a per-user value. Exported for tests. */
export const userKey = (base: string, uid: string = storageUid()): string => `u:${uid}:${base}`;

async function getJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
async function setJson(key: string, value: unknown): Promise<void> {
  try { await AsyncStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}
const getUser = <T>(base: string, fallback: T) => getJson<T>(userKey(base), fallback);
const setUser = (base: string, value: unknown) => setJson(userKey(base), value);

// ─── onboarding (device-global) ──────────────────────────────────────────────
export const isOnboarded = () => getJson<boolean>(DEVICE_KEYS.onboarded, false);
export const setOnboarded = (v = true) => setJson(DEVICE_KEYS.onboarded, v);

// ─── prefs (device-global) ───────────────────────────────────────────────────
export interface Prefs {
  category: CategoryFilter;
  region: Region;
  haptics: boolean;
  lang?: 'lv' | 'ru' | 'en';
}
export const DEFAULT_PREFS: Prefs = { category: 'flats', region: 'riga', haptics: true };
export const getPrefs = async () => ({ ...DEFAULT_PREFS, ...(await getJson<Partial<Prefs>>(DEVICE_KEYS.prefs, {})) });
export const setPrefs = async (patch: Partial<Prefs>) => setJson(DEVICE_KEYS.prefs, { ...(await getPrefs()), ...patch });

// ─── streak (per user) ───────────────────────────────────────────────────────
export type StreakBests = Partial<Record<CategoryFilter, number>>;
export const getStreakBests = () => getUser<StreakBests>(USER_KEYS.streakBest, {});
export async function recordStreakBest(category: CategoryFilter, length: number): Promise<number> {
  const bests = await getStreakBests();
  const best = Math.max(bests[category] ?? 0, length);
  await setUser(USER_KEYS.streakBest, { ...bests, [category]: best });
  return best;
}
export interface StreakCurrent { category: CategoryFilter; region: Region | null; length: number; sessionId: string }
export const getStreakCurrent = () => getUser<StreakCurrent | null>(USER_KEYS.streakCurrent, null);
export const setStreakCurrent = (s: StreakCurrent | null) => setUser(USER_KEYS.streakCurrent, s);

// ─── hints (per user) ────────────────────────────────────────────────────────
export const getHintTokens = () => getUser<number>(USER_KEYS.hintTokens, 0);
export const setHintTokens = (n: number) => setUser(USER_KEYS.hintTokens, Math.max(0, n));
export async function getRewardedHintsToday(day: string): Promise<number> {
  const v = await getUser<{ day: string; count: number }>(USER_KEYS.rewardedHints, { day, count: 0 });
  return v.day === day ? v.count : 0;
}
export async function bumpRewardedHintsToday(day: string): Promise<void> {
  const n = await getRewardedHintsToday(day);
  await setUser(USER_KEYS.rewardedHints, { day, count: n + 1 });
}

// ─── daily (per user) ────────────────────────────────────────────────────────
export interface StoredOutcome {
  round_no: number;
  listing_id: number;
  guess: number;
  price: number;
  score: number;
  err: number;
  cell: string;
  hints: HintType[];
  location: string | null;
  title_hint: string | null;
  thumb: string | null;
  source_url: string;
}
export interface DailyProgress { day: string; number: number; outcomes: StoredOutcome[] }
export const getDailyProgress = () => getUser<DailyProgress | null>(USER_KEYS.dailyProgress, null);
export const setDailyProgress = (p: DailyProgress | null) => setUser(USER_KEYS.dailyProgress, p);

export interface DailyLocalResult {
  day: string;
  number: number;
  total: number;
  grid: string;
  outcomes: StoredOutcome[];
  synced: boolean;
}
export const getDailyLocalResult = () => getUser<DailyLocalResult | null>(USER_KEYS.dailyLocalResult, null);
export const setDailyLocalResult = (r: DailyLocalResult | null) => setUser(USER_KEYS.dailyLocalResult, r);

export interface DailyStreak { lastDay: string; days: number }
export const getDailyStreak = () => getUser<DailyStreak | null>(USER_KEYS.dailyStreak, null);
/** Call once per completed daily. Returns the new streak length. */
export async function bumpDailyStreak(day: string, previousDay: string): Promise<number> {
  const cur = await getDailyStreak();
  if (cur?.lastDay === day) return cur.days;
  const days = cur?.lastDay === previousDay ? cur.days + 1 : 1;
  await setUser(USER_KEYS.dailyStreak, { lastDay: day, days });
  return days;
}

// ─── ads (per user) ──────────────────────────────────────────────────────────
export const getInterstitialLastShown = () => getUser<number>(USER_KEYS.interstitialLastShown, 0);
export const setInterstitialLastShown = (ts: number) => setUser(USER_KEYS.interstitialLastShown, ts);

/** Every per-user key of `uid` (default: the current user). */
export const userKeysOf = (uid: string = storageUid()): string[] => Object.values(USER_KEYS).map((k) => userKey(k, uid));

/** Wipe the current user's local state (sign-out / delete account); the device flags stay untouched. */
export async function clearUser(uid: string = storageUid()): Promise<void> {
  try { await AsyncStorage.multiRemove(userKeysOf(uid)); } catch { /* ignore */ }
}

/** Full local wipe (delete account): the current user's state plus the device flags. */
export async function clearAll(): Promise<void> {
  try { await AsyncStorage.multiRemove([...Object.values(DEVICE_KEYS), ...userKeysOf()]); } catch { /* ignore */ }
}
