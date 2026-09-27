/**
 * Identity providers: "save your progress" (link the anonymous device account to
 * Apple / Google) and "restore an existing account" on a fresh device.
 *
 * Supabase cannot link a native id token into an anonymous user
 * (linkIdentity is OAuth-redirect only), so signInWithIdToken always signs in
 * AS the provider user. The merge happens server-side (migrations 22 + 23):
 *   prepare_merge()  (as the current user)    → one-time token
 *   signInWithIdToken(...)                    → session is now the provider user
 *   claim_merge(token) (as the provider user) → moves data / drops the old user
 *
 * The current user may itself be a linked account (Profile → Account after a
 * "Replay intro", or a second provider): migration 23 lets any session prepare
 * a merge. claim_merge then either moves everything onto a NEW provider account
 * (the old auth user, and with it its old Apple/Google link, is deleted) or
 * restores an EXISTING one (an old *linked* account stays intact and can be
 * signed back into; an old anonymous account is dropped as before).
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
export const providerLabel = (p: Provider): string => PROVIDER_LABEL[p];

/** Apple "Hide My Email" addresses: never worth showing raw (i18n auth.private_relay instead). */
export const isPrivateRelay = (email: string | null | undefined): boolean =>
  typeof email === 'string' && /@privaterelay\.appleid\.com$/i.test(email);

/** One linked Apple / Google identity as the UI shows it. */
export interface LinkedAccount {
  provider: Provider;
  /** "Apple" / "Google" */
  label: string;
  /** E-mail Supabase stored in identity_data (null when the provider did not share one). */
  email: string | null;
  /** `email` is an Apple private-relay address. */
  privateRelay: boolean;
}

export const identityEmail = (i: UserIdentity): string | null => {
  const e = (i.identity_data as { email?: unknown } | undefined)?.email;
  return typeof e === 'string' && e.length > 0 ? e : null;
};

/** Apple / Google providers of `identities`, in identity order. */
export const linkedProviders = (identities: UserIdentity[]): Provider[] =>
  identities.map((i) => i.provider).filter(isProvider);

/**
 * Human-readable summary of the linked identities (Profile → Account, sign-in
 * modal): provider labels in identity order, one `accounts` entry per Apple /
 * Google identity, and the first e-mail (may be null; may be a relay address).
 */
export function describeIdentities(identities: UserIdentity[]): { providers: string[]; accounts: LinkedAccount[]; email: string | null } {
  const accounts: LinkedAccount[] = identities
    .filter((i) => isProvider(i.provider))
    .map((i) => {
      const email = identityEmail(i);
      return { provider: i.provider as Provider, label: PROVIDER_LABEL[i.provider as Provider], email, privateRelay: isPrivateRelay(email) };
    });
  return { providers: accounts.map((a) => a.label), accounts, email: accounts.find((a) => a.email)?.email ?? null };
}

/**
 * One line per linked account: "Apple (private relay)" (relayLabel) for a relay
 * address, "Google · name@gmail.com" with a real one, just "Apple" without any.
 */
export const formatAccount = (a: LinkedAccount, relayLabel: string): string =>
  a.privateRelay ? relayLabel : a.email ? `${a.label} · ${a.email}` : a.label;

/** Outcome of linkOrSignIn(): what happened to the previous account. */
export type LinkResult =
  | 'linked'    // previous account's progress moved onto the (new) provider account
  | 'restored'  // provider account already existed; its data wins (an anonymous previous account is dropped)
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
 * Sign in with `provider`; if the device had a session (anonymous or already
 * linked), merge it into the provider account when that one is new, or restore
 * the provider account when it already exists.
 * Throws ProviderCancelled (silent) or RpcError / Error (show to the user).
 */
export async function linkOrSignIn(provider: Provider): Promise<LinkResult> {
  if (!isConfigured) throw new RpcError('provider_unavailable');
  const { data: { session: before } } = await supabase.auth.getSession();

  // 1. merge token while we are still the current user (anonymous OR linked, see
  //    migration 23). Best effort: a failure here (offline, old backend that still
  //    rejects non-anonymous callers) only means the progress cannot be carried
  //    over, sign-in still works.
  let mergeToken: string | null = null;
  if (before) {
    try { mergeToken = await prepareMerge(); } catch { mergeToken = null; }
  }

  // 2. native sheet → id token → Supabase session for the provider user
  const token = provider === 'apple' ? await appleIdToken() : await googleIdToken();
  const { data, error } = await supabase.auth.signInWithIdToken({ provider, token });
  if (error) throw new RpcError(error.code ?? 'provider_error', error.message);
  const newId = data.user?.id;
  if (!newId) throw new RpcError('provider_error');
  if (!before || newId === before.user.id) return 'unchanged';

  // 3. carry the previous account's data over (or keep the existing account's data)
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
