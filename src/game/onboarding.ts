/**
 * Onboarding flow helpers (docs/11 §2.1), kept out of app/onboarding.tsx so the
 * timing rules are unit-testable:
 *  - `onboarded` is persisted the moment the user leaves the last slide (before
 *    the practice rounds), so killing the app mid-practice never restarts
 *    onboarding. Practice is optional.
 *  - Practice rounds ALWAYS use the bundled offline set, scored locally: no
 *    server tokens, so linking/restoring an account on the last slide (which
 *    changes auth.uid()) cannot invalidate them.
 *  - A restored account that already has a username skips practice entirely.
 * Depends on: ./session, ./storage, ./onboardingSet, src/auth/store.
 */
import type { LinkResult } from '../auth/providers';
import { useAuth } from '../auth/store';
import { track } from '../analytics';
import { ONBOARDING_SET } from './onboardingSet';
import { sessionActions } from './session';
import { setOnboarded } from './storage';

export const ONBOARDING_SESSION_ID = 'onboarding';
export const PRACTICE_ROUNDS = ONBOARDING_SET.length;

/** The user left the last slide (practice, skip, or straight home): onboarding is done from now on. */
export async function markOnboarded(): Promise<void> {
  await setOnboarded(true);
}

/** Persist the flag first, then start the local practice session. Resolves when the store is ready to render. */
export async function startPracticeSession(): Promise<void> {
  await markOnboarded();
  await sessionActions.startSession({
    mode: 'solo', category: 'all', rounds: ONBOARDING_SET, totalRounds: PRACTICE_ROUNDS,
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
