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
 * Both providers degrade gracefully: `googleConfigured` is false without the
 * EXPO_PUBLIC_GOOGLE_* env, `isAppleAvailable()` is false off iOS.
 * Depends on: src/api/supabase, src/api/rpc (prepareMerge, claimMerge), src/env.
 */
import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { GoogleSignin, isErrorWithCode, statusCodes } from '@react-native-google-signin/google-signin';
import { supabase } from '../api/supabase';
import { RpcError, claimMerge, prepareMerge } from '../api/rpc';
import { env, isConfigured } from '../env';

export type Provider = 'apple' | 'google';

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
  if (!mergeToken) return 'restored';
  const r = await claimMerge(mergeToken);
  return r.merged ? 'linked' : 'restored';
}
