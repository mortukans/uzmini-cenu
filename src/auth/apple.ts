/**
 * Username gate (file name kept so callers do not change; there is no Apple
 * sign-in any more — every account is a device-unique anonymous Supabase user).
 *
 * useRequireSignIn(): returns a function that resolves true immediately when the
 *               profile has a chosen username, else routes to /sign-in (the
 *               "choose a username" modal) and resolves after it closes
 *               (true = username saved, false = dismissed).
 * resolveSignIn(ok): called by app/sign-in.tsx when it closes.
 *
 * Depends on: src/auth/store (useAuth), expo-router.
 */
import { useCallback } from 'react';
import { router } from 'expo-router';
import { hasChosenUsername, isAutoUsername, useAuth } from './store';

export { hasChosenUsername, isAutoUsername };

let pending: ((ok: boolean) => void) | null = null;

/** Called by app/sign-in.tsx when it closes. */
export function resolveSignIn(ok: boolean) {
  pending?.(ok);
  pending = null;
}

/**
 * const requireSignIn = useRequireSignIn();
 * if (!(await requireSignIn())) return;   // user dismissed the username modal
 */
export function useRequireSignIn() {
  return useCallback((): Promise<boolean> => {
    if (useAuth.getState().hasUsername) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      pending?.(false);
      pending = resolve;
      // also resolve if the store learns about a username by any path
      const unsub = useAuth.subscribe((s) => {
        if (s.hasUsername) {
          unsub();
          resolveSignIn(true);
        }
      });
      router.push('/sign-in');
    });
  }, []);
}
