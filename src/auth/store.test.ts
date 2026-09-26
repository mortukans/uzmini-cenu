/**
 * Auth store: `justRestored` is set only when a provider sign-in RESTORED an
 * account that already has a chosen username, and is reset on every attempt.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const providers = vi.hoisted(() => ({ linkOrSignIn: vi.fn() }));
const rpc = vi.hoisted(() => ({ getMyProfile: vi.fn() }));
const supabase = vi.hoisted(() => ({
  auth: {
    getSession: vi.fn(async () => ({ data: { session: { user: { id: 'apple-user', is_anonymous: false, identities: [{ provider: 'apple' }] } } } })),
    onAuthStateChange: vi.fn(),
    signInAnonymously: vi.fn(),
    signOut: vi.fn(),
  },
}));

vi.mock('./providers', () => providers);
vi.mock('../api/rpc', () => rpc);
vi.mock('../api/supabase', () => ({ supabase }));
vi.mock('../env', () => ({ isConfigured: true, env: {} }));

import { useAuth } from './store';

const profile = (username: string) => ({ id: 'apple-user', username, avatar: null, lang: 'lv', is_premium: false, created_at: '' });

beforeEach(() => {
  providers.linkOrSignIn.mockReset();
  rpc.getMyProfile.mockReset();
  useAuth.setState({ justRestored: false, hasUsername: false, profile: null });
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
