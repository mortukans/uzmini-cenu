/**
 * AdMob placements (docs/07). Everything is behind env.ADS_ENABLED and a
 * no-op fallback so the app runs in a dev client without ads. Test unit ids
 * are used whenever the env ids are empty. Never block the game on an ad.
 */
import { env } from '../env';
import { track } from '../analytics';
import { getInterstitialLastShown, setInterstitialLastShown } from '../game/storage';

const INTERSTITIAL_EVERY = 5;
const MIN_GAP_MS = 90_000;

type Unsub = () => void;
interface AdLike {
  load(): void;
  show(): Promise<void>;
  readonly loaded: boolean;
  addAdEventListener(type: string, cb: (payload?: unknown) => void): Unsub;
}
interface AdsModule {
  InterstitialAd: { createForAdRequest(id: string, opts?: Record<string, unknown>): AdLike };
  RewardedAd: { createForAdRequest(id: string, opts?: Record<string, unknown>): AdLike };
  AdEventType: { LOADED: string; CLOSED: string; ERROR: string };
  RewardedAdEventType: { LOADED: string; EARNED_REWARD: string };
  TestIds: { INTERSTITIAL: string; REWARDED: string };
  default: () => { initialize(): Promise<unknown> };
}

let mod: AdsModule | null = null;
let interstitial: AdLike | null = null;
let rewarded: AdLike | null = null;
let initialised = false;

function loadModule(): AdsModule | null {
  if (!env.ADS_ENABLED) return null;
  if (mod) return mod;
  try {
    mod = require('react-native-google-mobile-ads') as AdsModule;
    return mod;
  } catch {
    return null;
  }
}

export const adsAvailable = () => loadModule() != null;

async function init() {
  const m = loadModule();
  if (!m || initialised) return;
  initialised = true;
  try { await m.default().initialize(); } catch { /* ads stay off */ }
}

const requestOptions = { requestNonPersonalizedAdsOnly: true };

/** Preload the interstitial (call at round 3 so it is ready by round 5). */
export async function preloadInterstitial() {
  const m = loadModule();
  if (!m) return;
  await init();
  if (interstitial?.loaded) return;
  const id = env.ADMOB_INTERSTITIAL_ID || m.TestIds.INTERSTITIAL;
  interstitial = m.InterstitialAd.createForAdRequest(id, requestOptions);
  interstitial.addAdEventListener(m.AdEventType.ERROR, () => track('ad_failed', { placement: 'solo_interstitial' }));
  interstitial.load();
}

/** docs/07: every 5th round, never in the first 5 rounds of the first session, ≥ 90 s apart. */
export async function shouldShowInterstitial(roundNo: number, isPremium: boolean, isFirstSession: boolean): Promise<boolean> {
  if (isPremium || !adsAvailable()) return false;
  if (roundNo % INTERSTITIAL_EVERY !== 0) return false;
  if (isFirstSession && roundNo <= INTERSTITIAL_EVERY) return false;
  const last = await getInterstitialLastShown();
  return Date.now() - last >= MIN_GAP_MS;
}

/** Resolves when the ad closes (or immediately if none is ready). Never throws. */
export function showInterstitial(): Promise<boolean> {
  const m = loadModule();
  const ad = interstitial;
  if (!m || !ad || !ad.loaded) { void preloadInterstitial(); return Promise.resolve(false); }
  return new Promise((resolve) => {
    const off = ad.addAdEventListener(m.AdEventType.CLOSED, () => {
      off();
      interstitial = null;
      void setInterstitialLastShown(Date.now());
      track('ad_shown', { placement: 'solo_interstitial' });
      void preloadInterstitial();
      resolve(true);
    });
    ad.show().catch(() => { off(); resolve(false); });
  });
}

export async function preloadRewarded() {
  const m = loadModule();
  if (!m) return;
  await init();
  if (rewarded?.loaded) return;
  const id = env.ADMOB_REWARDED_ID || m.TestIds.REWARDED;
  rewarded = m.RewardedAd.createForAdRequest(id, requestOptions);
  rewarded.addAdEventListener(m.AdEventType.ERROR, () => track('ad_failed', { placement: 'hint_rewarded' }));
  rewarded.load();
}

/** Resolves true only when the reward was earned. */
export function showRewarded(placement: 'hint_rewarded' | 'streak_continue_rewarded' = 'hint_rewarded'): Promise<boolean> {
  const m = loadModule();
  const ad = rewarded;
  if (!m || !ad || !ad.loaded) { void preloadRewarded(); return Promise.resolve(false); }
  return new Promise((resolve) => {
    let earned = false;
    const offReward = ad.addAdEventListener(m.RewardedAdEventType.EARNED_REWARD, () => { earned = true; });
    const offClose = ad.addAdEventListener(m.AdEventType.CLOSED, () => {
      offReward(); offClose();
      rewarded = null;
      track(earned ? 'ad_rewarded' : 'ad_shown', { placement });
      void preloadRewarded();
      resolve(earned);
    });
    ad.show().catch(() => { offReward(); offClose(); resolve(false); });
  });
}
