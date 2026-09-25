import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../api/supabase';
import { getMyProfile } from '../api/rpc';
import type { Profile } from '../api/types';
import { isConfigured } from '../env';

/**
 * Auth contract used by every screen.
 * - Every device is a device-unique anonymous Supabase user (signInAnonymously
 *   on first launch). There is no other sign-in method.
 * - Social features (friends, duels, rooms, daily leaderboard) need a chosen
 *   username: `hasUsername` is false while the profile still carries the
 *   server's 'player_xxxxxx' placeholder. The gate lives in src/auth/apple.ts
 *   (useRequireSignIn) and app/sign-in.tsx (username modal).
 */
interface AuthState {
  session: Session | null;
  profile: Profile | null;
  ready: boolean;
  /** True until a session exists. Kept for analytics; not a feature gate. */
  isAnonymous: boolean;
  /** Profile has a chosen (non-placeholder) username. */
  hasUsername: boolean;
  bootstrap: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  setSession: (s: Session | null) => void;
  signOut: () => Promise<void>;
}

/** Server default from handle_new_user(): 'player_' + 6 hex chars. */
export const isAutoUsername = (username: string | null | undefined): boolean =>
  !username || /^player_[0-9a-f]{6}$/.test(username);

export const hasChosenUsername = (profile: Profile | null | undefined): boolean =>
  Boolean(profile) && !isAutoUsername(profile!.username);

export const useAuth = create<AuthState>((set, get) => ({
  session: null,
  profile: null,
  ready: false,
  isAnonymous: true,
  hasUsername: false,

  setSession: (session) =>
    set({ session, isAnonymous: !session || Boolean((session.user as { is_anonymous?: boolean }).is_anonymous) }),

  bootstrap: async () => {
    if (!isConfigured) { set({ ready: true }); return; }
    const { data: { session } } = await supabase.auth.getSession();
    if (session) get().setSession(session);
    else {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (!error && data.session) get().setSession(data.session);
    }
    supabase.auth.onAuthStateChange((_e, s) => { get().setSession(s); if (s) void get().refreshProfile(); });
    await get().refreshProfile();
    set({ ready: true });
  },

  refreshProfile: async () => {
    if (!isConfigured) return;
    try {
      const profile = await getMyProfile();
      set({ profile, hasUsername: hasChosenUsername(profile) });
    } catch { /* offline: keep last */ }
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ profile: null, session: null, isAnonymous: true, hasUsername: false });
    await get().bootstrap();
  },
}));
