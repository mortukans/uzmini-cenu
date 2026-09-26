import { create } from 'zustand';
import type { Session, UserIdentity } from '@supabase/supabase-js';
import { supabase } from '../api/supabase';
import { getMyProfile } from '../api/rpc';
import type { Profile } from '../api/types';
import { isConfigured } from '../env';
import { linkOrSignIn, type LinkResult } from './providers';

/**
 * Auth contract used by every screen.
 * - Every device is a device-unique anonymous Supabase user (signInAnonymously
 *   on first launch). Nothing in the app requires anything more.
 * - Optional: link the account to Apple / Google ("save your progress") or sign
 *   in with one of them on a fresh device to restore an existing account. See
 *   src/auth/providers.ts. `isLinked` is true once an apple/google identity exists.
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
  /** user.identities of the current session (empty for anonymous users). */
  identities: UserIdentity[];
  /** Has an apple or google identity. */
  isLinked: boolean;
  bootstrap: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  setSession: (s: Session | null) => void;
  /** Link (or restore) with Apple. Throws ProviderCancelled | RpcError. */
  signInWithApple: () => Promise<LinkResult>;
  /** Link (or restore) with Google. Throws ProviderCancelled | RpcError. */
  signInWithGoogle: () => Promise<LinkResult>;
  /** Signs out and bootstraps a fresh anonymous account. */
  signOut: () => Promise<void>;
}

/** Server default from handle_new_user(): 'player_' + 6 hex chars. */
export const isAutoUsername = (username: string | null | undefined): boolean =>
  !username || /^player_[0-9a-f]{6}$/.test(username);

export const hasChosenUsername = (profile: Profile | null | undefined): boolean =>
  Boolean(profile) && !isAutoUsername(profile!.username);

const LINK_PROVIDERS = new Set(['apple', 'google']);
export const identitiesOf = (session: Session | null): UserIdentity[] => session?.user.identities ?? [];
export const hasLinkedIdentity = (ids: UserIdentity[]): boolean => ids.some((i) => LINK_PROVIDERS.has(i.provider));

let listening = false;

export const useAuth = create<AuthState>((set, get) => ({
  session: null,
  profile: null,
  ready: false,
  isAnonymous: true,
  hasUsername: false,
  identities: [],
  isLinked: false,

  setSession: (session) => {
    const identities = identitiesOf(session);
    set({
      session,
      isAnonymous: !session || Boolean((session.user as { is_anonymous?: boolean }).is_anonymous),
      identities,
      isLinked: hasLinkedIdentity(identities),
    });
  },

  bootstrap: async () => {
    if (!isConfigured) { set({ ready: true }); return; }
    const { data: { session } } = await supabase.auth.getSession();
    if (session) get().setSession(session);
    else {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (!error && data.session) get().setSession(data.session);
    }
    if (!listening) {
      listening = true;
      supabase.auth.onAuthStateChange((_e, s) => { get().setSession(s); if (s) void get().refreshProfile(); });
    }
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

  signInWithApple: async () => {
    const r = await linkOrSignIn('apple');
    await afterLink(get);
    return r;
  },

  signInWithGoogle: async () => {
    const r = await linkOrSignIn('google');
    await afterLink(get);
    return r;
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ profile: null, session: null, isAnonymous: true, hasUsername: false, identities: [], isLinked: false });
    await get().bootstrap();
  },
}));

/** After signInWithIdToken + claim_merge: refresh the session (identities) and the merged profile. */
async function afterLink(get: () => AuthState) {
  const { data: { session } } = await supabase.auth.getSession();
  get().setSession(session);
  await get().refreshProfile();
}
