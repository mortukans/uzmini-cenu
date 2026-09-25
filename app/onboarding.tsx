/** Onboarding (docs/11 §2.1): language chips, then 3 practice rounds in the regular round screen. */
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { getRounds } from '../src/api/rpc';
import type { Lang } from '../src/api/types';
import { isConfigured } from '../src/env';
import { ONBOARDING_SET } from '../src/game/onboardingSet';
import { sessionActions } from '../src/game/session';
import { setOnboarded, setPrefs } from '../src/game/storage';
import { SUPPORTED, currentLang, setLang } from '../src/i18n';
import { screenView, track } from '../src/analytics';
import { haptic } from '../src/ui/haptics';
import { Button, Screen } from '../src/ui/components';
import { colors, radius, spacing, type } from '../src/ui/theme';

const LOAD_TIMEOUT_MS = 3000;

export default function Onboarding() {
  const { t } = useTranslation();
  const [lang, setLangState] = useState<Lang>(currentLang());
  const [busy, setBusy] = useState(false);

  useEffect(() => { screenView('onboarding'); track('onboarding_start'); }, []);

  const pickLang = async (l: Lang) => {
    void haptic.step();
    setLangState(l);
    await setLang(l);
    await setPrefs({ lang: l });
    track('language_set', { lang: l, source: 'onboarding' });
  };

  const start = async () => {
    setBusy(true);
    try {
      const rounds = isConfigured
        ? await Promise.race([
          getRounds('all', null, 3).catch(() => null),
          new Promise<null>((r) => setTimeout(() => r(null), LOAD_TIMEOUT_MS)),
        ])
        : null;
      if (rounds && rounds.length >= 3) {
        await sessionActions.startSession({ mode: 'solo', category: 'all', rounds, totalRounds: 3, sessionId: 'onboarding' });
      } else {
        await sessionActions.startSession({ mode: 'solo', category: 'all', rounds: ONBOARDING_SET, totalRounds: 3, sessionId: 'onboarding', localScoring: true });
      }
      router.replace('/play/onboarding');
    } finally {
      setBusy(false);
    }
  };

  const skip = async () => {
    await setOnboarded(true);
    track('onboarding_complete', { total: 0, skipped: true });
    router.replace('/(tabs)');
  };

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <Pressable onPress={() => { void skip(); }} style={styles.skip} accessibilityRole="button">
        <Text style={styles.skipText}>{t('onboarding.skip')}</Text>
      </Pressable>
      <View style={styles.center}>
        <Text style={styles.brand}>Uzmini Cenu</Text>
        <Text style={styles.tagline}>{t('onboarding.tagline')}</Text>
        <View style={styles.langs}>
          {SUPPORTED.map((l) => (
            <Pressable key={l} onPress={() => { void pickLang(l); }} style={[styles.lang, lang === l && styles.langOn]} accessibilityRole="button" accessibilityState={{ selected: lang === l }}>
              <Text style={[styles.langText, lang === l && styles.langTextOn]}>{l.toUpperCase()}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.steps}>
          <Text style={styles.step}>1 · {t('onboarding.step_photo')}</Text>
          <Text style={styles.step}>2 · {t('onboarding.step_price')}</Text>
          <Text style={styles.step}>3 · {t('onboarding.step_guess')}</Text>
        </View>
      </View>
      <Button title={t('onboarding.try')} onPress={() => { void start(); }} loading={busy} />
      <Text style={styles.foot}>{t('onboarding.no_account')}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  skip: { alignSelf: 'flex-end', paddingVertical: spacing.md },
  skipText: { ...type.body, color: colors.textMuted },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.lg },
  brand: { ...type.display, color: colors.text },
  tagline: { ...type.body, color: colors.textMuted, textAlign: 'center', paddingHorizontal: spacing.xl },
  langs: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  lang: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, minWidth: 64, alignItems: 'center' },
  langOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  langText: { ...type.body, color: colors.text, fontWeight: '600' },
  langTextOn: { color: colors.accentText },
  steps: { marginTop: spacing.xl, gap: spacing.sm },
  step: { ...type.body, color: colors.text },
  foot: { ...type.small, color: colors.textMuted, textAlign: 'center', marginTop: spacing.md, marginBottom: spacing.sm },
});
