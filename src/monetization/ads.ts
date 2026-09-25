/**
 * Ads are not part of v1 (decision 2026-09-25: free app, no ads). The AdMob SDK was removed
 * from the build because it injects NSUserTrackingUsageDescription, which App Review treats
 * as a tracking declaration. This module keeps the API the round screen calls, as no-ops.
 * To re-enable later: `npx expo install react-native-google-mobile-ads`, restore the config
 * plugin in app.config.ts and the implementation from git history.
 */
export const adsAvailable = () => false;
export async function preloadInterstitial(): Promise<void> {}
export async function shouldShowInterstitial(_roundNo: number, _isPremium: boolean, _isFirstSession: boolean): Promise<boolean> { return false; }
export function showInterstitial(): Promise<boolean> { return Promise.resolve(false); }
export async function preloadRewarded(): Promise<void> {}
export function showRewarded(_placement: 'hint_rewarded' | 'streak_continue_rewarded' = 'hint_rewarded'): Promise<boolean> { return Promise.resolve(false); }
