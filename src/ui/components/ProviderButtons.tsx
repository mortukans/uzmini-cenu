/**
 * "Continue with Apple" (native black button, iOS only) + "Continue with Google"
 * (white button, text "G" glyph — no assets). Used by onboarding slide 4,
 * app/sign-in.tsx and Profile → Account. Renders nothing when neither provider
 * is available. Cancelled sheets are silent; other errors → Alert (i18n auth.err.*).
 * Depends on: src/auth/store (signInWithApple/Google), src/auth/providers.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useTranslation } from 'react-i18next';
import { RpcError } from '../../api/rpc';
import { ProviderCancelled, googleConfigured, isAppleAvailable, type LinkResult, type Provider } from '../../auth/providers';
import { useAuth } from '../../auth/store';
import { track } from '../../analytics';
import { colors, radius, spacing } from '../theme';

interface Props {
  /** Called after a successful link / restore. */
  onDone?: (result: LinkResult, provider: Provider) => void;
  /** Show the "progress saved / account restored" alert (default true). */
  announce?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** True when at least one provider can show a button on this device/build. */
export function useProvidersAvailable(): { apple: boolean; google: boolean; any: boolean } {
  const [apple, setApple] = useState(false);
  useEffect(() => { let on = true; void isAppleAvailable().then((v) => { if (on) setApple(v); }); return () => { on = false; }; }, []);
  return { apple, google: googleConfigured, any: apple || googleConfigured };
}

export function ProviderButtons({ onDone, announce = true, style }: Props) {
  const { t } = useTranslation();
  const { signInWithApple, signInWithGoogle } = useAuth();
  const { apple, google } = useProvidersAvailable();
  const [busy, setBusy] = useState<Provider | null>(null);

  const run = async (provider: Provider) => {
    if (busy) return;
    setBusy(provider);
    track('identity_link_start', { provider });
    try {
      const result = await (provider === 'apple' ? signInWithApple() : signInWithGoogle());
      track('identity_link_done', { provider, result });
      if (announce && result !== 'unchanged') {
        Alert.alert(t(`auth.${result}_title`), t(`auth.${result}_body`));
      }
      onDone?.(result, provider);
    } catch (e) {
      if (e instanceof ProviderCancelled) { track('identity_link_cancel', { provider }); return; }
      const code = e instanceof RpcError ? e.code : 'unknown';
      track('identity_link_error', { provider, code });
      Alert.alert(t('common.error'), t(`auth.err.${code}`, { defaultValue: t('auth.err.unknown') }));
    } finally {
      setBusy(null);
    }
  };

  if (!apple && !google) return null;

  return (
    <View style={[styles.wrap, style]}>
      {apple && (
        busy === 'apple' ? (
          <View style={[styles.btn, styles.appleBusy]}><ActivityIndicator color="#FFFFFF" /></View>
        ) : (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
            cornerRadius={radius.lg}
            style={styles.btn}
            onPress={() => { void run('apple'); }}
          />
        )
      )}
      {google && (
        <Pressable
          onPress={() => { void run('google'); }}
          disabled={busy != null}
          accessibilityRole="button"
          accessibilityLabel={t('auth.google')}
          style={({ pressed }) => [styles.btn, styles.google, pressed && styles.pressed, busy != null && busy !== 'google' && styles.dim]}
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
