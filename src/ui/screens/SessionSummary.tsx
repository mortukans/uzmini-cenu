/**
 * End-of-session summary for free play, streak and onboarding practice.
 * Extracted from app/play/[sessionId].tsx so the session review can grow
 * without touching the round screen. Rendered by the play route when the
 * session phase is SUMMARY (mode !== daily).
 */
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { formatEur } from '../../game/format';
import { maxScore, totalScore, type Outcome } from '../../game/machine';
import { sessionActions, useSession } from '../../game/session';
import { setOnboarded } from '../../game/storage';
import { rigaDay } from '../../game/time';
import { currentLang } from '../../i18n';
import { screenView, track } from '../../analytics';
import { Button, Screen } from '../components';
import { colors, gridColor, radius, spacing, type } from '../theme';

export function SessionSummary({ isOnboarding, sessionId }: { isOnboarding: boolean; sessionId: string }) {
  const { t } = useTranslation();
  const lang = currentLang();
  const s = useSession();
  const cfg = s.config;
  const total = totalScore(s);
  const max = maxScore(s);
  const avg = s.outcomes.length ? Math.round(total / s.outcomes.length) : 0;
  const bias = s.outcomes.length
    ? Math.round((s.outcomes.reduce((a, o) => a + (o.guess - o.price) / o.price, 0) / s.outcomes.length) * 100)
    : 0;
  const last = s.outcomes[s.outcomes.length - 1];

  useEffect(() => { screenView(isOnboarding ? 'onboarding_summary' : cfg?.mode === 'streak' ? 'streak_over' : 'session_summary'); }, [isOnboarding, cfg?.mode]);

  const finishOnboarding = async () => {
    await setOnboarded(true);
    track('onboarding_complete', { total, skipped: false });
    sessionActions.reset();
    router.replace('/(tabs)');
  };

  const playAgain = () => {
    track('summary_play_again', { mode: cfg?.mode });
    void sessionActions.startSession({ mode: cfg?.mode ?? 'solo', category: cfg?.category, region: cfg?.region, sessionId });
  };

  const home = () => { sessionActions.reset(); router.replace('/(tabs)'); };

  if (isOnboarding) {
    return (
      <Screen edges={['top', 'left', 'right', 'bottom']}>
        <View style={[styles.body, styles.center]}>
          <Text style={styles.summaryEyebrow}>{t('onboarding.done_eyebrow')}</Text>
          <Text style={styles.big}>{t('practice.started_with', { count: total })}</Text>
          <Text style={styles.grid}>{s.outcomes.map((o) => o.cell).join('')}</Text>
          <Text style={styles.summarySub}>{t('onboarding.done_body')}</Text>
        </View>
        <Button title={t('onboarding.start')} onPress={() => { void finishOnboarding(); }} />
      </Screen>
    );
  }

  if (cfg?.mode === 'streak') {
    return (
      <Screen scroll edges={['top', 'left', 'right', 'bottom']}>
        <Text style={styles.summaryEyebrow}>{t('streak.over')}</Text>
        <Text style={styles.big}>{s.streak}</Text>
        <Text style={styles.summarySub}>{t('streak.best', { n: Math.max(s.streakBest, s.streak) })}</Text>
        {last && (
          <View style={styles.missCard}>
            <Text style={styles.missLabel}>{last.round.location ?? t(`category.${last.round.category}`)}</Text>
            <Text style={styles.missRow}>{t('round.asking')}: {formatEur(last.price, lang)}</Text>
            <Text style={styles.missRow}>{t('reveal.your_guess')}: {formatEur(last.guess, lang)} ({Math.round(last.err * 100)} %)</Text>
          </View>
        )}
        <Button title={t('streak.try_again')} onPress={playAgain} style={{ marginTop: spacing.xl }} />
        <Button title={t('common.home')} variant='ghost' onPress={home} style={{ marginTop: spacing.sm }} />
      </Screen>
    );
  }

  return (
    <Screen scroll edges={['top', 'left', 'right', 'bottom']}>
      <Text style={styles.summaryEyebrow}>{t('summary.title')}</Text>
      <Text style={styles.big}>{max ? t('summary.total', { n: total.toLocaleString(lang === 'en' ? 'en-US' : 'lv-LV'), max: max.toLocaleString(lang === 'en' ? 'en-US' : 'lv-LV') }) : total}</Text>
      <Text style={styles.summarySub}>{t('summary.avg', { count: avg })}</Text>
      {s.outcomes.length > 0 && (
        <Text style={styles.summarySub}>{bias > 0 ? t('summary.bias_over', { pct: Math.abs(bias) }) : bias < 0 ? t('summary.bias_under', { pct: Math.abs(bias) }) : t('summary.bias_none')}</Text>
      )}
      <View style={styles.rows}>
        {s.outcomes.map((o: Outcome) => (
          <View key={o.roundNo} style={styles.row}>
            <Text style={styles.rowNo}>{o.roundNo}</Text>
            <Text style={styles.rowName} numberOfLines={1}>{o.round.location ?? t(`category.${o.round.category}`)}</Text>
            <Text style={styles.rowNum}>{formatEur(o.guess, lang)}</Text>
            <Text style={styles.rowNum}>{formatEur(o.price, lang)}</Text>
            <Text style={[styles.rowScore, { color: gridColor(o.cell) }]}>{o.score}</Text>
          </View>
        ))}
      </View>
      <Button title={t('summary.play_again')} onPress={playAgain} style={{ marginTop: spacing.xl }} />
      <Button title={t('common.home')} variant='ghost' onPress={home} style={{ marginTop: spacing.sm }} />
      <Text style={styles.dayFoot}>{rigaDay()}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, paddingHorizontal: spacing.lg },
  center: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  summaryEyebrow: { ...type.small, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginTop: spacing.xl, textAlign: 'center' },
  big: { ...type.display, color: colors.text, textAlign: 'center', marginTop: spacing.sm, fontVariant: ['tabular-nums'] },
  grid: { fontSize: 28, textAlign: 'center', marginTop: spacing.sm },
  summarySub: { ...type.body, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xs },
  missCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, marginTop: spacing.xl, gap: 4 },
  missLabel: { ...type.h3, color: colors.text },
  missRow: { ...type.body, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  rows: { marginTop: spacing.xl, gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  rowNo: { ...type.small, color: colors.textMuted, width: 18 },
  rowName: { ...type.small, color: colors.text, flex: 1 },
  rowNum: { ...type.small, color: colors.textMuted, fontVariant: ['tabular-nums'], width: 74, textAlign: 'right' },
  rowScore: { ...type.small, fontWeight: '700', fontVariant: ['tabular-nums'], width: 44, textAlign: 'right' },
  dayFoot: { ...type.small, color: colors.border, textAlign: 'center', marginTop: spacing.xl },
});
