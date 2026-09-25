/**
 * Small typed wrapper over AsyncStorage for local game state: onboarding flag,
 * preferences, streak bests, hint tokens, daily progress / local results.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CategoryFilter, Region } from '../api/types';
import type { HintType } from './hints';

const KEYS = {
  onboarded: 'uc.onboarded',
  prefs: 'uc.prefs',
  streakBest: 'uc.streak.best',
  streakCurrent: 'uc.streak.current',
  hintTokens: 'uc.hint.tokens',
  rewardedHints: 'uc.hint.rewarded', // { day, count }
  dailyProgress: 'uc.daily.progress',
  dailyLocalResult: 'uc.daily.local', // anonymous result, keyed by day
  dailyStreak: 'uc.daily.streak', // { lastDay, days }
  interstitialLastShown: 'uc.ads.last',
} as const;

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

// ─── onboarding ──────────────────────────────────────────────────────────────
export const isOnboarded = () => getJson<boolean>(KEYS.onboarded, false);
export const setOnboarded = (v = true) => setJson(KEYS.onboarded, v);

// ─── prefs ───────────────────────────────────────────────────────────────────
export interface Prefs {
  category: CategoryFilter;
  region: Region;
  haptics: boolean;
  lang?: 'lv' | 'ru' | 'en';
}
export const DEFAULT_PREFS: Prefs = { category: 'flats', region: 'riga', haptics: true };
export const getPrefs = async () => ({ ...DEFAULT_PREFS, ...(await getJson<Partial<Prefs>>(KEYS.prefs, {})) });
export const setPrefs = async (patch: Partial<Prefs>) => setJson(KEYS.prefs, { ...(await getPrefs()), ...patch });

// ─── streak ──────────────────────────────────────────────────────────────────
export type StreakBests = Partial<Record<CategoryFilter, number>>;
export const getStreakBests = () => getJson<StreakBests>(KEYS.streakBest, {});
export async function recordStreakBest(category: CategoryFilter, length: number): Promise<number> {
  const bests = await getStreakBests();
  const best = Math.max(bests[category] ?? 0, length);
  await setJson(KEYS.streakBest, { ...bests, [category]: best });
  return best;
}
export interface StreakCurrent { category: CategoryFilter; region: Region | null; length: number; sessionId: string }
export const getStreakCurrent = () => getJson<StreakCurrent | null>(KEYS.streakCurrent, null);
export const setStreakCurrent = (s: StreakCurrent | null) => setJson(KEYS.streakCurrent, s);

// ─── hints ───────────────────────────────────────────────────────────────────
export const getHintTokens = () => getJson<number>(KEYS.hintTokens, 0);
export const setHintTokens = (n: number) => setJson(KEYS.hintTokens, Math.max(0, n));
export async function getRewardedHintsToday(day: string): Promise<number> {
  const v = await getJson<{ day: string; count: number }>(KEYS.rewardedHints, { day, count: 0 });
  return v.day === day ? v.count : 0;
}
export async function bumpRewardedHintsToday(day: string): Promise<void> {
  const n = await getRewardedHintsToday(day);
  await setJson(KEYS.rewardedHints, { day, count: n + 1 });
}

// ─── daily ───────────────────────────────────────────────────────────────────
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
export const getDailyProgress = () => getJson<DailyProgress | null>(KEYS.dailyProgress, null);
export const setDailyProgress = (p: DailyProgress | null) => setJson(KEYS.dailyProgress, p);

export interface DailyLocalResult {
  day: string;
  number: number;
  total: number;
  grid: string;
  outcomes: StoredOutcome[];
  synced: boolean;
}
export const getDailyLocalResult = () => getJson<DailyLocalResult | null>(KEYS.dailyLocalResult, null);
export const setDailyLocalResult = (r: DailyLocalResult | null) => setJson(KEYS.dailyLocalResult, r);

export interface DailyStreak { lastDay: string; days: number }
export const getDailyStreak = () => getJson<DailyStreak | null>(KEYS.dailyStreak, null);
/** Call once per completed daily. Returns the new streak length. */
export async function bumpDailyStreak(day: string, previousDay: string): Promise<number> {
  const cur = await getDailyStreak();
  if (cur?.lastDay === day) return cur.days;
  const days = cur?.lastDay === previousDay ? cur.days + 1 : 1;
  await setJson(KEYS.dailyStreak, { lastDay: day, days });
  return days;
}

// ─── ads ─────────────────────────────────────────────────────────────────────
export const getInterstitialLastShown = () => getJson<number>(KEYS.interstitialLastShown, 0);
export const setInterstitialLastShown = (ts: number) => setJson(KEYS.interstitialLastShown, ts);

/** Full local wipe (delete account). */
export async function clearAll(): Promise<void> {
  try { await AsyncStorage.multiRemove(Object.values(KEYS)); } catch { /* ignore */ }
}
