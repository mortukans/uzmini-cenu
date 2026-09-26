/**
 * Identity providers: "save your progress" (link the anonymous device account to
 * Apple / Google) and "restore an existing account" on a fresh device.
 *
 * Supabase cannot link a native id token into an anonymous user
 * (linkIdentity is OAuth-redirect only), so signInWithIdToken always signs in
 * AS the provider user. The merge happens server-side (migration 22):
 *   prepare_merge()  (as the anonymous user)  → one-time token
 *   signInWithIdToken(...)                    → session is now the provider user
 *   claim_merge(token) (as the provider user) → moves data / drops the anon user
 *
 * After a merge / restore the *current UI language* is written to the profile
 * (the user may have just picked it on the onboarding welcome slide); the
 * profile's stored `lang` never silently switches the UI.
 *
 * Both providers degrade gracefully: `googleConfigured` is false without the
 * EXPO_PUBLIC_GOOGLE_* env, `isAppleAvailable()` is false off iOS.
 * Depends on: src/api/supabase, src/api/rpc (prepareMerge, claimMerge, updateProfile), src/env, src/i18n (currentLang).
 */
import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { GoogleSignin, isErrorWithCode, statusCodes } from '@react-native-google-signin/google-signin';
import type { UserIdentity } from '@supabase/supabase-js';
import { supabase } from '../api/supabase';
import { RpcError, claimMerge, prepareMerge, updateProfile } from '../api/rpc';
import { env, isConfigured } from '../env';
import { currentLang } from '../i18n';

export type Provider = 'apple' | 'google';

const PROVIDER_LABEL: Record<Provider, string> = { apple: 'Apple', google: 'Google' };
export const isProvider = (p: string): p is Provider => p === 'apple' || p === 'google';

/**
 * Human-readable summary of the linked identities (Profile → Account, sign-in
 * modal): provider labels in identity order + the first e-mail Supabase stored
 * in identity_data (Apple may hand out a private-relay address; may be null).
 */
export function describeIdentities(identities: UserIdentity[]): { providers: string[]; email: string | null } {
  const linked = identities.filter((i) => isProvider(i.provider));
  const providers = linked.map((i) => PROVIDER_LABEL[i.provider as Provider]);
  const email = linked
    .map((i) => (i.identity_data as { email?: unknown } | undefined)?.email)
    .find((e): e is string => typeof e === 'string' && e.length > 0) ?? null;
  return { providers, email };
}

/** Outcome of linkOrSignIn(): what happened to the previous anonymous account. */
export type LinkResult =
  | 'linked'    // anonymous progress moved onto the provider account
  | 'restored'  // provider account already existed; its data wins, anon account dropped
  | 'unchanged'; // already signed in as this provider user (nothing to merge)

/** Thrown when the user dismissed the native sheet. Callers stay silent. */
export class ProviderCancelled extends Error {
  constructor() { super('cancelled'); this.name = 'ProviderCancelled'; }
}

export const googleConfigured = Platform.OS !== 'web' && Boolean(env.GOOGLE_WEB_CLIENT_ID);

export async function isAppleAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try { return await AppleAuthentication.isAvailableAsync(); } catch { return false; }
}

// ─── tokens ──────────────────────────────────────────────────────────────────

async function appleIdToken(): Promise<string> {
  try {
    const cred = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
    });
    if (!cred.identityToken) throw new RpcError('provider_no_token');
    return cred.identityToken;
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') throw new ProviderCancelled();
    throw e;
  }
}

let googleReady = false;
function ensureGoogle() {
  if (googleReady) return;
  GoogleSignin.configure({ webClientId: env.GOOGLE_WEB_CLIENT_ID, iosClientId: env.GOOGLE_IOS_CLIENT_ID });
  googleReady = true;
}

async function googleIdToken(): Promise<string> {
  if (!googleConfigured) throw new RpcError('provider_unavailable');
  ensureGoogle();
  try {
    if (Platform.OS === 'android') await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const res = await GoogleSignin.signIn();
    if (res.type === 'cancelled') throw new ProviderCancelled();
    if (!res.data.idToken) throw new RpcError('provider_no_token');
    return res.data.idToken;
  } catch (e) {
    if (e instanceof ProviderCancelled) throw e;
    if (isErrorWithCode(e) && (e.code === statusCodes.SIGN_IN_CANCELLED || e.code === statusCodes.IN_PROGRESS)) throw new ProviderCancelled();
    throw e;
  }
}

// ─── link / restore ──────────────────────────────────────────────────────────

/**
 * Sign in with `provider`; if the device was anonymous, merge it into the provider
 * account. Throws ProviderCancelled (silent) or RpcError / Error (show to the user).
 */
export async function linkOrSignIn(provider: Provider): Promise<LinkResult> {
  if (!isConfigured) throw new RpcError('provider_unavailable');
  const { data: { session: before } } = await supabase.auth.getSession();
  const wasAnonymous = Boolean(before && (before.user as { is_anonymous?: boolean }).is_anonymous);

  // 1. token while we are still the anonymous user (best effort: a failure here
  //    only means the progress cannot be carried over, sign-in still works)
  let mergeToken: string | null = null;
  if (wasAnonymous) {
    try { mergeToken = await prepareMerge(); } catch { mergeToken = null; }
  }

  // 2. native sheet → id token → Supabase session for the provider user
  const token = provider === 'apple' ? await appleIdToken() : await googleIdToken();
  const { data, error } = await supabase.auth.signInWithIdToken({ provider, token });
  if (error) throw new RpcError(error.code ?? 'provider_error', error.message);
  const newId = data.user?.id;
  if (!newId) throw new RpcError('provider_error');
  if (!before || newId === before.user.id) return 'unchanged';

  // 3. carry the anonymous data over (or drop it when the account already exists)
  let result: LinkResult = 'restored';
  if (mergeToken) {
    const r = await claimMerge(mergeToken);
    result = r.merged ? 'linked' : 'restored';
  }

  // 4. the language the user is looking at wins over the profile's stored one.
  //    Must run before the store refreshes the profile (afterLink) so nothing
  //    ever sees the stale `lang`. Best effort: offline just keeps it stale.
  try { await updateProfile({ lang: currentLang() }); } catch { /* keep UI language; profile.lang stays stale */ }

  return result;
}
