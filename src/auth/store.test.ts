/**
 * Auth store:
 * - `justRestored` is set only when a provider sign-in RESTORED an account that
 *   already has a chosen username, and is reset on every attempt.
 * - `identities` / `isLinked` survive auth-event session snapshots that come
 *   without identities; only auth.getUser() may downgrade them.
 * - linkOutcome(): which alert a link / restore deserves.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session, User, UserIdentity } from '@supabase/supabase-js';

type AuthHandler = (event: string, session: Session | null) => void;

const providers = vi.hoisted(() => ({
  linkOrSignIn: vi.fn(),
  linkedProviders: (ids: Array<{ provider: string }>) => ids.map((i) => i.provider).filter((p) => p === 'apple' || p === 'google'),
}));
const rpc = vi.hoisted(() => ({ getMyProfile: vi.fn() }));
const supabase = vi.hoisted(() => {
  const appleIdentity = { provider: 'apple', identity_id: 'ident-1', id: 'sub-1', user_id: 'apple-user', identity_data: { email: 'x@privaterelay.appleid.com' } };
  const appleUser = { id: 'apple-user', is_anonymous: false, identities: [appleIdentity] };
  const state: { handler: AuthHandler | null } = { handler: null };
  return {
    appleIdentity,
    appleUser,
    state,
    auth: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getSession: vi.fn(async (): Promise<any> => ({ data: { session: { user: appleUser } } })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getUser: vi.fn(async (): Promise<any> => ({ data: { user: appleUser }, error: null })),
      onAuthStateChange: vi.fn((cb: AuthHandler) => { state.handler = cb; return { data: { subscription: { unsubscribe: () => {} } } }; }),
      signInAnonymously: vi.fn(),
      signOut: vi.fn(),
    },
  };
});

vi.mock('./providers', () => providers);
vi.mock('../api/rpc', () => rpc);
vi.mock('../api/supabase', () => ({ supabase }));
vi.mock('../env', () => ({ isConfigured: true, env: {} }));

import { accountSnapshot, linkOutcome, sameIdentities, useAuth, type AccountSnapshot } from './store';

const profile = (username: string, id = 'apple-user') => ({ id, username, avatar: null, lang: 'lv' as const, is_premium: false, created_at: '' });
const sessionOf = (user: Partial<User>) => ({ user } as unknown as Session);
const ids = (...list: Array<Partial<UserIdentity>>) => list as UserIdentity[];
/** Let the deferred (setTimeout 0) onAuthStateChange refresh and its getUser() settle. */
const flush = () => new Promise<void>((r) => { setTimeout(r, 5); });

beforeEach(() => {
  providers.linkOrSignIn.mockReset();
  rpc.getMyProfile.mockReset();
  rpc.getMyProfile.mockResolvedValue(null);
  supabase.auth.getSession.mockReset();
  supabase.auth.getSession.mockResolvedValue({ data: { session: sessionOf(supabase.appleUser) } });
  supabase.auth.getUser.mockReset();
  supabase.auth.getUser.mockResolvedValue({ data: { user: supabase.appleUser as unknown as User }, error: null });
  useAuth.setState({ session: null, justRestored: false, hasUsername: false, profile: null, identities: [], isLinked: false, isAnonymous: true });
});

describe('justRestored', () => {
  it('is true after restoring an account that already has a username', async () => {
    providers.linkOrSignIn.mockResolvedValueOnce('restored');
    rpc.getMyProfile.mockResolvedValueOnce(profile('martins'));
    await expect(useAuth.getState().signInWithApple()).resolves.toBe('restored');
    expect(useAuth.getState().hasUsername).toBe(true);
    expect(useAuth.getState().isLinked).toBe(true);
    expect(useAuth.getState().justRestored).toBe(true);
    useAuth.getState().clearJustRestored();
    expect(useAuth.getState().justRestored).toBe(false);
  });

  it('stays false for a restored account with a placeholder username', async () => {
    providers.linkOrSignIn.mockResolvedValueOnce('restored');
    rpc.getMyProfile.mockResolvedValueOnce(profile('player_a1b2c3'));
    await useAuth.getState().signInWithGoogle();
    expect(useAuth.getState().hasUsername).toBe(false);
    expect(useAuth.getState().justRestored).toBe(false);
  });

  it('stays false for a plain link, and a new attempt resets a stale true', async () => {
    useAuth.setState({ justRestored: true });
    providers.linkOrSignIn.mockResolvedValueOnce('linked');
    rpc.getMyProfile.mockResolvedValueOnce(profile('martins'));
    await useAuth.getState().signInWithApple();
    expect(useAuth.getState().justRestored).toBe(false);
  });
});

describe('identities survive auth-event snapshots', () => {
  it('SIGNED_IN with identities → USER_UPDATED without identities: isLinked stays true', async () => {
    await useAuth.getState().bootstrap();
    const handler = supabase.state.handler!;
    expect(handler).toBeTypeOf('function');

    handler('SIGNED_IN', sessionOf(supabase.appleUser));
    await flush();
    expect(useAuth.getState().isLinked).toBe(true);
    const linked = useAuth.getState().identities;

    // Snapshot for the same user, no `identities` at all (TOKEN_REFRESHED / USER_UPDATED shape).
    handler('USER_UPDATED', sessionOf({ id: 'apple-user', is_anonymous: false }));
    expect(useAuth.getState().isLinked).toBe(true);          // synchronously: no downgrade from a snapshot
    expect(useAuth.getState().identities).toBe(linked);      // memoized: same reference
    await flush();                                           // getUser() confirms
    expect(useAuth.getState().isLinked).toBe(true);
    expect(useAuth.getState().identities).toBe(linked);

    // Same with an explicitly empty array in the snapshot.
    handler('TOKEN_REFRESHED', sessionOf({ id: 'apple-user', is_anonymous: false, identities: [] }));
    await flush();
    expect(useAuth.getState().isLinked).toBe(true);
    expect(useAuth.getState().identities).toBe(linked);
  });

  it('refreshProfile after set_username keeps the linked state (getUser is authoritative)', async () => {
    useAuth.getState().setSession(sessionOf(supabase.appleUser));
    rpc.getMyProfile.mockResolvedValueOnce(profile('test1'));
    await useAuth.getState().refreshProfile();
    expect(useAuth.getState().hasUsername).toBe(true);
    expect(useAuth.getState().isLinked).toBe(true);
    expect(useAuth.getState().identities).toHaveLength(1);
  });

  it('only getUser() may downgrade: identities [] for the same user → isLinked false', async () => {
    useAuth.getState().setSession(sessionOf(supabase.appleUser));
    expect(useAuth.getState().isLinked).toBe(true);
    supabase.auth.getUser.mockResolvedValueOnce({ data: { user: { id: 'apple-user', is_anonymous: false, identities: [] } as unknown as User }, error: null });
    await useAuth.getState().syncUser();
    expect(useAuth.getState().isLinked).toBe(false);
    expect(useAuth.getState().identities).toEqual([]);
  });

  it('a failed / stale getUser() answer never touches the store', async () => {
    useAuth.getState().setSession(sessionOf(supabase.appleUser));
    supabase.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: new Error('offline') });
    await useAuth.getState().syncUser();
    expect(useAuth.getState().isLinked).toBe(true);
    // answer for a different user than the current session
    supabase.auth.getUser.mockResolvedValueOnce({ data: { user: { id: 'someone-else', is_anonymous: true, identities: [] } as unknown as User }, error: null });
    await useAuth.getState().syncUser();
    expect(useAuth.getState().isLinked).toBe(true);
  });

  it('a snapshot for a DIFFERENT user replaces the identities', () => {
    useAuth.getState().setSession(sessionOf(supabase.appleUser));
    useAuth.getState().setSession(sessionOf({ id: 'anon-2', is_anonymous: true, identities: [] }));
    expect(useAuth.getState().isLinked).toBe(false);
    expect(useAuth.getState().isAnonymous).toBe(true);
  });

  it('a snapshot that ADDS a provider for the same user is taken', () => {
    useAuth.getState().setSession(sessionOf(supabase.appleUser));
    const both = ids(supabase.appleIdentity as Partial<UserIdentity>, { provider: 'google', identity_id: 'ident-2', id: 'sub-2', identity_data: { email: 'a@gmail.com' } });
    useAuth.getState().setSession(sessionOf({ id: 'apple-user', is_anonymous: false, identities: both }));
    expect(useAuth.getState().identities).toHaveLength(2);
  });

  it('sameIdentities ignores order and reference', () => {
    const a = ids({ provider: 'apple', identity_id: '1' }, { provider: 'google', identity_id: '2' });
    const b = ids({ provider: 'google', identity_id: '2' }, { provider: 'apple', identity_id: '1' });
    expect(sameIdentities(a, b)).toBe(true);
    expect(sameIdentities(a, ids({ provider: 'apple', identity_id: '1' }))).toBe(false);
  });
});

describe('linkOutcome', () => {
  const snap = (p: Partial<AccountSnapshot>): AccountSnapshot => ({ userId: 'u', username: null, providers: [], ...p });
  const anonNamed = snap({ userId: 'anon', username: 'test1' });
  const appleNamed = snap({ userId: 'apple-user', username: 'test1', providers: ['apple'] });

  it('unchanged / plain link / plain restore', () => {
    expect(linkOutcome('apple', 'unchanged', anonNamed, anonNamed)).toEqual({ kind: 'unchanged' });
    expect(linkOutcome('apple', 'linked', snap({ userId: 'anon' }), snap({ userId: 'apple-user', providers: ['apple'] }))).toEqual({ kind: 'linked' });
    expect(linkOutcome('google', 'restored', snap({ userId: 'anon' }), snap({ userId: 'g', username: 'hshs', providers: ['google'] }))).toEqual({ kind: 'restored' });
  });

  it('switched: a named user lands on a different named account (old one still reachable via its provider)', () => {
    expect(linkOutcome('google', 'restored', appleNamed, snap({ userId: 'g', username: 'hshs', providers: ['google'] })))
      .toEqual({ kind: 'switched', username: 'hshs', oldUsername: 'test1', oldProviders: ['apple'] });
    // anonymous previous account: gone
    expect(linkOutcome('google', 'restored', anonNamed, snap({ userId: 'g', username: 'hshs', providers: ['google'] })))
      .toEqual({ kind: 'switched', username: 'hshs', oldUsername: 'test1', oldProviders: [] });
  });

  it('restored account without a username is a plain restore even for a named user', () => {
    expect(linkOutcome('google', 'restored', appleNamed, snap({ userId: 'g', providers: ['google'] }))).toEqual({ kind: 'restored' });
  });

  it('merged_from_linked: a linked account moved onto a new provider account', () => {
    expect(linkOutcome('google', 'linked', appleNamed, snap({ userId: 'g', username: 'test1', providers: ['google'] })))
      .toEqual({ kind: 'merged_from_linked', provider: 'google', oldProviders: ['apple'] });
  });

  it('accountSnapshot reads the store shape', () => {
    expect(accountSnapshot({
      session: sessionOf({ id: 'apple-user' }), profile: profile('test1'), hasUsername: true,
      identities: ids({ provider: 'apple' }, { provider: 'email' }),
    })).toEqual({ userId: 'apple-user', username: 'test1', providers: ['apple'] });
    expect(accountSnapshot({ session: null, profile: profile('player_abcdef'), hasUsername: false, identities: [] }))
      .toEqual({ userId: null, username: null, providers: [] });
  });
});
