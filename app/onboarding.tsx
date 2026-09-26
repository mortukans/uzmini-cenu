/**
 * Onboarding (docs/11 §2.1): 4-slide horizontal pager (paging ScrollView) with
 * dots + Skip, then the existing 3 practice rounds in the regular round screen.
 *   1 welcome (icon, pitch, language chips)   2 how to play (photo → guess → points)
 *   3 daily challenge + duels                  4 save your progress (ProviderButtons,
 *     "Continue without account" → practice rounds). Nothing requires an account.
 * Depends on: src/game/session, src/game/storage (setOnboarded/setPrefs), src/ui/components.
 */
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { Image } from 'expo-image';
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
import { Button, ProviderButtons, Screen } from '../src/ui/components';
import { colors, radius, spacing, type } from '../src/ui/theme';

const LOAD_TIMEOUT_MS = 3000;
const SLIDES = 4;

export default function Onboarding() {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const pager = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);
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

  const goTo = (i: number) => {
    const next = Math.max(0, Math.min(SLIDES - 1, i));
    pager.current?.scrollTo({ x: next * width, animated: true });
    setPage(next);
  };

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width));
    if (i !== page) { setPage(i); track('onboarding_slide', { index: i }); }
  };

  /** Practice rounds (unchanged flow): server rounds, or the bundled set offline. */
  const startPractice = async () => {
    if (busy) return;
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

  const last = page === SLIDES - 1;

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']} padded={false}>
      <View style={styles.top}>
        <Pressable onPress={() => { void skip(); }} style={styles.skip} accessibilityRole="button" hitSlop={8}>
          <Text style={styles.skipText}>{t('onboarding.skip')}</Text>
        </Pressable>
      </View>

      <ScrollView
        ref={pager}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScrollEnd}
        style={styles.pager}
        contentContainerStyle={{ width: width * SLIDES }}
      >
        {/* 1 · welcome */}
        <View style={[styles.slide, { width }]}>
          <Image source={require('../assets/splash-icon.png')} style={styles.icon} contentFit="contain" accessibilityIgnoresInvertColors />
          <Text style={styles.brand}>{t('onboarding.s1_title')}</Text>
          <Text style={styles.body}>{t('onboarding.tagline')}</Text>
          <View style={styles.langs}>
            {SUPPORTED.map((l) => (
              <Pressable key={l} onPress={() => { void pickLang(l); }} style={[styles.lang, lang === l && styles.langOn]} accessibilityRole="button" accessibilityState={{ selected: lang === l }}>
                <Text style={[styles.langText, lang === l && styles.langTextOn]}>{l.toUpperCase()}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* 2 · how to play: static illustration from theme colours */}
        <View style={[styles.slide, { width }]}>
          <HowToPlay photo={t('onboarding.s2_photo')} guess={t('onboarding.s2_guess')} points={t('onboarding.s2_points')} />
          <Text style={styles.h1}>{t('onboarding.s2_title')}</Text>
          <Text style={styles.body}>{t('onboarding.s2_body')}</Text>
          <View style={styles.steps}>
            <Text style={styles.step}>1 · {t('onboarding.step_photo')}</Text>
            <Text style={styles.step}>2 · {t('onboarding.step_price')}</Text>
            <Text style={styles.step}>3 · {t('onboarding.step_guess')}</Text>
          </View>
        </View>

        {/* 3 · daily + duels */}
        <View style={[styles.slide, { width }]}>
          <View style={styles.pair}>
            <View style={styles.tile}><Text style={styles.tileGlyph}>📅</Text><Text style={styles.tileLabel}>{t('home.daily')}</Text></View>
            <View style={[styles.tile, styles.tileAlt]}><Text style={styles.tileGlyph}>⚔️</Text><Text style={styles.tileLabel}>{t('home.duel')}</Text></View>
          </View>
          <Text style={styles.h1}>{t('onboarding.s3_title')}</Text>
          <Text style={styles.body}>{t('onboarding.s3_daily')}</Text>
          <Text style={styles.body}>{t('onboarding.s3_duel')}</Text>
        </View>

        {/* 4 · save progress (optional) */}
        <View style={[styles.slide, { width }]}>
          <View style={styles.shield}><Text style={styles.shieldGlyph}>☁️</Text></View>
          <Text style={styles.h1}>{t('onboarding.s4_title')}</Text>
          <Text style={styles.body}>{t('onboarding.s4_body')}</Text>
          <ProviderButtons style={styles.providers} onDone={() => { void startPractice(); }} />
        </View>
      </ScrollView>

      <View style={styles.dots} accessibilityRole="progressbar" accessibilityValue={{ min: 1, max: SLIDES, now: page + 1 }}>
        {Array.from({ length: SLIDES }, (_, i) => (
          <Pressable key={i} onPress={() => goTo(i)} hitSlop={6} style={[styles.dot, i === page && styles.dotOn]} />
        ))}
      </View>

      <View style={styles.footer}>
        {last ? (
          <>
            <Button title={t('auth.continue_without')} variant="secondary" onPress={() => { void startPractice(); }} loading={busy} />
            <Text style={styles.foot}>{t('onboarding.try')} · {t('onboarding.no_account')}</Text>
          </>
        ) : (
          <Button title={t('onboarding.next')} onPress={() => goTo(page + 1)} />
        )}
      </View>
    </Screen>
  );
}

/** Three cards: photo → guess → points, built from tokens only (no images). */
function HowToPlay({ photo, guess, points }: { photo: string; guess: string; points: string }) {
  return (
    <View style={styles.illu}>
      <View style={styles.card}>
        <View style={styles.fakePhoto}><View style={styles.fakeSun} /><View style={styles.fakeHouse} /></View>
        <Text style={styles.cardLabel}>{photo}</Text>
      </View>
      <Text style={styles.arrow}>→</Text>
      <View style={styles.card}>
        <Text style={styles.fakePrice}>48 500 €</Text>
        <Text style={styles.cardLabel}>{guess}</Text>
      </View>
      <Text style={styles.arrow}>→</Text>
      <View style={[styles.card, styles.cardAccent]}>
        <Text style={styles.fakePoints}>+870</Text>
        <Text style={[styles.cardLabel, { color: colors.accentText }]}>{points}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: spacing.lg },
  skip: { paddingVertical: spacing.md },
  skipText: { ...type.body, color: colors.textMuted },
  pager: { flex: 1 },
  slide: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.lg, paddingHorizontal: spacing.xl },
  icon: { width: 120, height: 120 },
  brand: { ...type.display, color: colors.text, textAlign: 'center' },
  h1: { ...type.h1, color: colors.text, textAlign: 'center' },
  body: { ...type.body, color: colors.textMuted, textAlign: 'center' },
  langs: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  lang: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, minWidth: 64, alignItems: 'center' },
  langOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  langText: { ...type.body, color: colors.text, fontWeight: '600' },
  langTextOn: { color: colors.accentText },
  steps: { gap: spacing.sm, alignSelf: 'stretch' },
  step: { ...type.body, color: colors.text, textAlign: 'center' },
  // slide 2 illustration
  illu: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  card: { width: 84, height: 96, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.sm },
  cardAccent: { backgroundColor: colors.accent, borderColor: colors.accent },
  cardLabel: { ...type.small, color: colors.textMuted },
  fakePhoto: { width: 60, height: 40, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  fakeSun: { position: 'absolute', top: 6, right: 8, width: 10, height: 10, borderRadius: 5, backgroundColor: colors.yellow },
  fakeHouse: { position: 'absolute', bottom: 0, left: 12, width: 36, height: 20, backgroundColor: colors.blue, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  fakePrice: { ...type.h3, color: colors.text, fontVariant: ['tabular-nums'] },
  fakePoints: { ...type.h2, color: colors.accentText, fontVariant: ['tabular-nums'] },
  arrow: { ...type.h2, color: colors.textMuted },
  // slide 3
  pair: { flexDirection: 'row', gap: spacing.md },
  tile: { width: 120, height: 120, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  tileAlt: { backgroundColor: colors.surfaceAlt },
  tileGlyph: { fontSize: 40 },
  tileLabel: { ...type.small, color: colors.text, fontWeight: '600' },
  // slide 4
  shield: { width: 96, height: 96, borderRadius: 48, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  shieldGlyph: { fontSize: 44 },
  providers: { alignSelf: 'stretch', marginTop: spacing.sm },
  // chrome
  dots: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  dotOn: { backgroundColor: colors.accent, width: 20 },
  footer: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  foot: { ...type.small, color: colors.textMuted, textAlign: 'center', marginTop: spacing.md, marginBottom: spacing.sm },
});
