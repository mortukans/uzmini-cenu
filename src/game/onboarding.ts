/**
 * Onboarding flow helpers (docs/11 §2.1), kept out of app/onboarding.tsx so the
 * timing rules are unit-testable:
 *  - `onboarded` is persisted the moment the user leaves the last slide (before
 *    the practice rounds), so killing the app mid-practice never restarts
 *    onboarding. Practice is optional.
 *  - Practice rounds are REAL listings from `get_offline_pack` (rounds that
 *    carry `price_eur` and an empty token), scored locally: no server tokens,
 *    so linking/restoring an account on the last slide (which changes
 *    auth.uid()) cannot invalidate them, and submit_guess is never called.
 *    The bundled ONBOARDING_SET is only the fallback when the RPC fails, is
 *    slow, or returns fewer than PRACTICE_ROUNDS usable rounds (offline).
 *  - A restored account that already has a username skips practice entirely.
 * Depends on: ./session, ./storage, ./onboardingSet, src/api/rpc, src/auth/store.
 */
import { getOfflinePack } from '../api/rpc';
import type { LinkResult } from '../auth/providers';
import { useAuth } from '../auth/store';
import { isConfigured } from '../env';
import { track } from '../analytics';
import { ONBOARDING_SET, type OfflineRound } from './onboardingSet';
import { sessionActions } from './session';
import { setOnboarded } from './storage';

export const ONBOARDING_SESSION_ID = 'onboarding';
export const PRACTICE_ROUNDS = ONBOARDING_SET.length;
/** The "Continue without account" button spins while the pack loads; past this we play the bundled set. */
export const PRACTICE_FETCH_TIMEOUT_MS = 6_000;

/** The user left the last slide (practice, skip, or straight home): onboarding is done from now on. */
export async function markOnboarded(): Promise<void> {
  await setOnboarded(true);
}

/** A round from the offline pack is playable when it carries a positive price to score against. */
const usable = (r: Partial<OfflineRound> | null | undefined): r is OfflineRound =>
  Boolean(r) && typeof r!.price_eur === 'number' && Number.isFinite(r!.price_eur) && r!.price_eur! > 0 && Array.isArray(r!.photo_urls);

/**
 * Real listings with prices for the practice rounds, or the bundled set when
 * the server cannot supply PRACTICE_ROUNDS of them (offline, rate limited,
 * unconfigured env, timeout). Never throws.
 */
export async function loadPracticeRounds(): Promise<OfflineRound[]> {
  if (!isConfigured) return ONBOARDING_SET;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const pack = await Promise.race([
      getOfflinePack('all', PRACTICE_ROUNDS),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), PRACTICE_FETCH_TIMEOUT_MS); }),
    ]);
    const rounds = (Array.isArray(pack) ? pack : []).filter(usable).slice(0, PRACTICE_ROUNDS);
    if (rounds.length >= PRACTICE_ROUNDS) {
      track('practice_pack', { source: 'server' });
      return rounds;
    }
  } catch { /* fall through to the bundled set */ } finally {
    if (timer) clearTimeout(timer);
  }
  track('practice_pack', { source: 'bundled' });
  return ONBOARDING_SET;
}

/** Persist the flag first, then start the locally scored practice session. Resolves when the store is ready to render. */
export async function startPracticeSession(): Promise<void> {
  await markOnboarded();
  const rounds = await loadPracticeRounds();
  await sessionActions.startSession({
    mode: 'solo', category: 'all', rounds, totalRounds: PRACTICE_ROUNDS,
    sessionId: ONBOARDING_SESSION_ID, localScoring: true,
  });
}

/**
 * After a successful link/restore on the last slide: go home when an existing
 * account with a username was restored (store flag, see useAuth.justRestored),
 * otherwise continue to practice. Consumes the flag either way.
 */
export function nextAfterLink(result: LinkResult): 'home' | 'practice' {
  const { justRestored, clearJustRestored } = useAuth.getState();
  clearJustRestored();
  if (result === 'restored' && justRestored) {
    track('onboarding_complete', { total: 0, skipped: true, restored: true });
    return 'home';
  }
  return 'practice';
}
