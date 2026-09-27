/**
 * "Continue with Apple" (native black button, iOS only) + "Continue with Google"
 * (white button, text "G" glyph — no assets). Used by onboarding slide 4,
 * app/sign-in.tsx and Profile → Account. Renders nothing when neither provider
 * is available. Cancelled sheets are silent; other errors → Alert (i18n auth.err.*).
 *
 * Flow per press: both buttons disabled while one sign-in is in flight →
 * store.signInWithX() (merge + profile refresh) → loading reset → one alert
 * describing what happened (awaited until the user taps OK) → `onDone(ProviderDone)`.
 * So a parent may navigate / close a modal inside onDone without racing the alert.
 *
 * The alert is picked from the account BEFORE vs AFTER the sign-in
 * (store.linkOutcome): progress saved / account restored, and the two cases a
 * user with a chosen username must be told about — "switched account" (landed
 * on a different existing account) and "merged from a linked account" (the old
 * Apple/Google link is gone).
 * Depends on: src/auth/store (signInWithApple/Google, accountSnapshot, linkOutcome), src/auth/providers.
 */
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { RpcError } from '../../api/rpc';
import { ProviderCancelled, googleConfigured, isAppleAvailable, providerLabel, type LinkResult, type Provider } from '../../auth/providers';
import { accountSnapshot, linkOutcome, useAuth, type LinkOutcome } from '../../auth/store';
import { track } from '../../analytics';
import { colors, radius, spacing } from '../theme';

/** Passed to `onDone` once the sign-in finished AND the alert (if any) was dismissed. */
export interface ProviderDone {
  provider: Provider;
  /** What happened to the previous account (see src/auth/providers LinkResult). */
  result: LinkResult;
  /** Finer-grained than `result`: what the user was told (see src/auth/store LinkOutcome). */
  outcome: LinkOutcome;
  /** The (merged / restored) profile already carries a chosen username; read from the auth store after its refresh. */
  hasUsername: boolean;
}

interface Props {
  /**
   * Called after a successful link / restore, only once the outcome alert has
   * been dismissed (or immediately when there is none: `announce={false}` or
   * result 'unchanged'). Never called on cancel or error.
   */
  onDone?: (done: ProviderDone) => void;
  /** Show the outcome alert (default true). */
  announce?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** True when at least one provider can show a button on this device/build. */
export function useProvidersAvailable(): { apple: boolean; google: boolean; any: boolean } {
  const [apple, setApple] = useState(false);
  useEffect(() => { let on = true; void isAppleAvailable().then((v) => { if (on) setApple(v); }); return () => { on = false; }; }, []);
  return { apple, google: googleConfigured, any: apple || googleConfigured };
}

/** Title + body of the alert for an outcome (null for 'unchanged'). i18n common.auth.*. */
export function outcomeMessage(t: TFunction, o: LinkOutcome): { title: string; body: string } | null {
  const labels = (ps: Provider[]) => ps.map(providerLabel).join(', ');
  switch (o.kind) {
    case 'unchanged': return null;
    case 'linked': return { title: t('auth.linked_title'), body: t('auth.linked_body') };
    case 'merged_from_linked':
      return { title: t('auth.linked_title'), body: t('auth.merged_from_linked_body', { provider: providerLabel(o.provider), oldProviders: labels(o.oldProviders) }) };
    case 'restored': return { title: t('auth.restored_title'), body: t('auth.restored_body') };
    case 'switched':
      return {
        title: t('auth.switched_title'),
        body: o.oldProviders.length
          ? t('auth.switched_body', { username: o.username, oldUsername: o.oldUsername, oldProviders: labels(o.oldProviders) })
          : t('auth.switched_body_lost', { username: o.username, oldUsername: o.oldUsername }),
      };
  }
}

/** Alert.alert as a Promise: resolves when the user taps OK (or the alert is dismissed on Android). */
const alertAsync = (title: string, message: string, ok: string) => new Promise<void>((resolve) => {
  let done = false;
  const finish = () => { if (!done) { done = true; resolve(); } };
  Alert.alert(title, message, [{ text: ok, onPress: finish }], { cancelable: true, onDismiss: finish });
});

/** The native sheet / Google web chooser is still animating away when signIn resolves; an alert presented at that moment can be dropped on iOS. */
const settle = () => new Promise<void>((resolve) => { setTimeout(resolve, 350); });

export function ProviderButtons({ onDone, announce = true, style }: Props) {
  const { t } = useTranslation();
  const { signInWithApple, signInWithGoogle } = useAuth();
  const { apple, google } = useProvidersAvailable();
  const [busy, setBusy] = useState<Provider | null>(null);
  // Guard against double taps between the press and the re-render (state is async).
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const stopLoading = () => { inFlight.current = false; if (mounted.current) setBusy(null); };

  const run = async (provider: Provider) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(provider);
    track('identity_link_start', { provider });
    try {
      const before = accountSnapshot(useAuth.getState());
      const result = await (provider === 'apple' ? signInWithApple() : signInWithGoogle());
      const after = useAuth.getState();
      const outcome = linkOutcome(provider, result, before, accountSnapshot(after));
      track('identity_link_done', { provider, result, outcome: outcome.kind });
      // The sign-in is over: release the buttons before the alert, not after it.
      stopLoading();
      const msg = announce ? outcomeMessage(t, outcome) : null;
      if (msg) {
        await settle();
        await alertAsync(msg.title, msg.body, t('common.ok'));
      }
      onDone?.({ provider, result, outcome, hasUsername: after.hasUsername });
    } catch (e) {
      stopLoading();
      if (e instanceof ProviderCancelled) { track('identity_link_cancel', { provider }); return; }
      const code = e instanceof RpcError ? e.code : 'unknown';
      track('identity_link_error', { provider, code });
      await settle();
      Alert.alert(t('common.error'), t(`auth.err.${code}`, { defaultValue: t('auth.err.unknown') }));
    } finally {
      // Always: cancel, error, success, and any throw from onDone.
      stopLoading();
    }
  };

  if (!apple && !google) return null;
  const locked = busy != null;

  return (
    <View style={[styles.wrap, style]}>
      {apple && (
        busy === 'apple' ? (
          <View style={[styles.btn, styles.appleBusy]}><ActivityIndicator color="#FFFFFF" /></View>
        ) : (
          // The native button has no `disabled`; block touches + dim while Google is in flight.
          <View pointerEvents={locked ? 'none' : 'auto'} style={[styles.btn, locked && styles.dim]} accessibilityState={{ disabled: locked }}>
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
              cornerRadius={radius.lg}
              style={styles.btn}
              onPress={() => { void run('apple'); }}
            />
          </View>
        )
      )}
      {google && (
        <Pressable
          onPress={() => { void run('google'); }}
          disabled={locked}
          accessibilityRole="button"
          accessibilityLabel={t('auth.google')}
          accessibilityState={{ disabled: locked, busy: busy === 'google' }}
          style={({ pressed }) => [styles.btn, styles.google, pressed && styles.pressed, locked && busy !== 'google' && styles.dim]}
        >
          {busy === 'google' ? <ActivityIndicator color="#1F1F1F" /> : (
            <>
              <View style={styles.g}><Text style={styles.gText}>G</Text></View>
              <Text style={styles.googleLabel}>{t('auth.google')}</Text>
            </>
          )}
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  btn: { height: 52, width: '100%', borderRadius: radius.lg },
  appleBusy: { backgroundColor: '#000000', alignItems: 'center', justifyContent: 'center' },
  google: { backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderWidth: 1, borderColor: '#DADCE0' },
  googleLabel: { color: '#1F1F1F', fontSize: 17, fontWeight: '600' },
  g: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#4285F4' },
  gText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14, lineHeight: 16 },
  pressed: { opacity: 0.85 },
  dim: { opacity: 0.5 },
});
