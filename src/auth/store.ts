import { create } from 'zustand';
import type { Session, User, UserIdentity } from '@supabase/supabase-js';
import { supabase } from '../api/supabase';
import { getMyProfile } from '../api/rpc';
import type { Profile } from '../api/types';
import { isConfigured } from '../env';
import { linkOrSignIn, linkedProviders, type LinkResult, type Provider } from './providers';

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
 *
 * Identities: the session snapshots that onAuthStateChange hands out are NOT
 * authoritative for `user.identities` (a TOKEN_REFRESHED / USER_UPDATED session
 * can carry a user without them). So a snapshot may only *add* linked
 * identities for the same user; `isLinked` is downgraded solely by syncUser()
 * (auth.getUser()), which runs after every auth event and every profile
 * refresh (set_username, link, restore). `identities` keeps its reference
 * until the set really changes (screens can depend on it safely).
 */
interface AuthState {
  session: Session | null;
  profile: Profile | null;
  ready: boolean;
  /** True until a session exists. Kept for analytics; not a feature gate. */
  isAnonymous: boolean;
  /** Profile has a chosen (non-placeholder) username. */
  hasUsername: boolean;
  /** Linked identities of the current user (empty for anonymous users). See the identities note above. */
  identities: UserIdentity[];
  /** Has an apple or google identity. */
  isLinked: boolean;
  /**
   * The last signInWith* call restored an existing provider account that
   * already has a chosen username (nothing left to set up). Onboarding reads
   * this to skip the remaining slides / practice and go straight home, then
   * clears it. Reset at the start of every signInWith* call.
   */
  justRestored: boolean;
  clearJustRestored: () => void;
  /**
   * Bootstrap / onAuthStateChange only touch *this* store (session, profile).
   * They must never reset the game session or navigate: a link/restore can
   * happen mid-round, and src/game/session re-issues its round tokens itself
   * when auth.uid() changes.
   */
  bootstrap: () => Promise<void>;
  /** Profile (username) + authoritative identities, in parallel. Offline: keeps the last values. */
  refreshProfile: () => Promise<void>;
  /** Authoritative identities / is_anonymous from auth.getUser(). The only path that may set isLinked back to false. */
  syncUser: () => Promise<void>;
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

/** Order-independent fingerprint: provider + identity id + e-mail (the parts the UI shows). */
const identityKey = (ids: UserIdentity[]): string =>
  ids
    .map((i) => `${i.provider}:${i.identity_id ?? i.id}:${(i.identity_data as { email?: unknown } | undefined)?.email ?? ''}`)
    .sort()
    .join('|');
export const sameIdentities = (a: UserIdentity[], b: UserIdentity[]): boolean => a === b || identityKey(a) === identityKey(b);

const isAnonymousUser = (u: User | null | undefined): boolean => !u || Boolean((u as { is_anonymous?: boolean }).is_anonymous);

let listening = false;
/** Sequence of syncUser() calls: a slow getUser() answer never overwrites a newer one. */
let syncSeq = 0;

export const useAuth = create<AuthState>((set, get) => ({
  session: null,
  profile: null,
  ready: false,
  isAnonymous: true,
  hasUsername: false,
  identities: [],
  isLinked: false,
  justRestored: false,
  clearJustRestored: () => set({ justRestored: false }),

  setSession: (session) => {
    const prev = get();
    const sameUser = Boolean(session && prev.session && session.user.id === prev.session.user.id);
    const snapshot = session?.user.identities;
    let identities = prev.identities;
    if (!session) identities = [];
    else if (!sameUser) identities = snapshot ?? [];               // another user: start from the snapshot, syncUser() confirms
    else if (snapshot && hasLinkedIdentity(snapshot) && !sameIdentities(snapshot, prev.identities)) identities = snapshot; // real change only
    // same user + snapshot without (linked) identities: keep what we have — only syncUser() may downgrade
    set({
      session,
      isAnonymous: !session || isAnonymousUser(session.user),
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
      // Store-only side effects (see the AuthState doc): no game-session reset, no navigation.
      // Supabase runs these callbacks inside its session lock: the getUser()/profile
      // round-trip is deferred out of it (see supabase.auth.onAuthStateChange docs).
      supabase.auth.onAuthStateChange((_e, s) => {
        get().setSession(s);
        if (s) setTimeout(() => { void get().refreshProfile(); }, 0);
      });
    }
    await get().refreshProfile();
    set({ ready: true });
  },

  refreshProfile: async () => {
    if (!isConfigured) return;
    const [profile] = await Promise.all([
      getMyProfile().catch(() => undefined), // offline: keep last
      get().syncUser(),
    ]);
    if (profile !== undefined) set({ profile, hasUsername: hasChosenUsername(profile) });
  },

  syncUser: async () => {
    if (!isConfigured) return;
    const seq = ++syncSeq;
    let user: User | null = null;
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error) return; // offline / signed out (auth-js emits SIGNED_OUT itself): keep what we have
      user = data.user;
    } catch { return; }
    const cur = get();
    if (!user || seq !== syncSeq) return;                   // a newer sync is on its way
    if (!cur.session || cur.session.user.id !== user.id) return; // answer for a previous user
    const identities = user.identities ?? [];
    const patch: Partial<AuthState> = { isAnonymous: isAnonymousUser(user) };
    if (!sameIdentities(identities, cur.identities)) {
      patch.identities = identities;
      patch.isLinked = hasLinkedIdentity(identities);
    }
    set(patch);
  },

  signInWithApple: () => linkWith('apple', get, set),
  signInWithGoogle: () => linkWith('google', get, set),

  signOut: async () => {
    await supabase.auth.signOut();
    syncSeq++; // drop any getUser() answer still in flight for the old user
    set({ profile: null, session: null, isAnonymous: true, hasUsername: false, identities: [], isLinked: false, justRestored: false });
    await get().bootstrap();
  },
}));

type Set = (patch: Partial<AuthState>) => void;

/** linkOrSignIn + refresh; flags `justRestored` when an existing account with a username came back. */
async function linkWith(provider: 'apple' | 'google', get: () => AuthState, set: Set): Promise<LinkResult> {
  set({ justRestored: false });
  const r = await linkOrSignIn(provider);
  await afterLink(get);
  set({ justRestored: r === 'restored' && get().hasUsername });
  return r;
}

/** After signInWithIdToken + claim_merge: refresh the session, the authoritative identities and the merged profile. */
async function afterLink(get: () => AuthState) {
  const { data: { session } } = await supabase.auth.getSession();
  get().setSession(session);
  await get().refreshProfile();
}

// ─── what a link / restore did to the account (ProviderButtons' alert) ───────

/** The account as it was right before (or is right after) a signInWith* call. */
export interface AccountSnapshot {
  userId: string | null;
  /** Chosen username, null while it is still the placeholder. */
  username: string | null;
  providers: Provider[];
}

export const accountSnapshot = (s: Pick<AuthState, 'session' | 'profile' | 'hasUsername' | 'identities'>): AccountSnapshot => ({
  userId: s.session?.user.id ?? null,
  username: s.hasUsername ? s.profile?.username ?? null : null,
  providers: linkedProviders(s.identities),
});

export type LinkOutcome =
  | { kind: 'unchanged' }
  /** Anonymous progress moved onto the provider account ("Progress saved"). */
  | { kind: 'linked' }
  /** An already linked account moved onto a NEW provider account: the old auth user, and its old link, are gone. */
  | { kind: 'merged_from_linked'; provider: Provider; oldProviders: Provider[] }
  /** An existing provider account came back ("Account restored"). */
  | { kind: 'restored' }
  /**
   * The user had a chosen username and now sits in a DIFFERENT named account.
   * `oldProviders` non-empty: the previous account is still there (sign back in
   * with it); empty: it was anonymous and is gone.
   */
  | { kind: 'switched'; username: string; oldUsername: string; oldProviders: Provider[] };

export function linkOutcome(provider: Provider, result: LinkResult, before: AccountSnapshot, after: AccountSnapshot): LinkOutcome {
  if (result === 'unchanged') return { kind: 'unchanged' };
  if (result === 'linked') {
    return before.providers.length ? { kind: 'merged_from_linked', provider, oldProviders: before.providers } : { kind: 'linked' };
  }
  const switched = before.username && after.username && after.username !== before.username && before.userId !== after.userId;
  if (switched) return { kind: 'switched', username: after.username!, oldUsername: before.username!, oldProviders: before.providers };
  return { kind: 'restored' };
}
