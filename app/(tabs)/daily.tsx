/** Daily tab: intro or status (docs/11 §2.7). The full intro lives in daily/index. */
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { getDaily } from '../../src/api/rpc';
import { isConfigured } from '../../src/env';
import { getDailyLocalResult, getDailyProgress, getDailyStreak } from '../../src/game/storage';
import { formatDay } from '../../src/game/time';
import { currentLang } from '../../src/i18n';
import { screenView, track } from '../../src/analytics';
import { Button, CountdownText, Screen, Skeleton } from '../../src/ui/components';
import { colors, radius, spacing, type } from '../../src/ui/theme';

export default function DailyTab() {
  const { t } = useTranslation();
  const lang = currentLang();
  const daily = useQuery({ queryKey: ['daily'], queryFn: getDaily, enabled: isConfigured, staleTime: 60_000, retry: 2 });
  const [local, setLocal] = useState<{ day: string; total: number; grid: string } | null>(null);
  const [resume, setResume] = useState<number | null>(null);
  const [streakDays, setStreakDays] = useState(0);

  useFocusEffect(useCallback(() => {
    screenView('daily_tab');
    void daily.refetch();
    void getDailyLocalResult().then(setLocal);
    void getDailyProgress().then((p) => setResume(p && p.day === daily.data?.day ? p.outcomes.length + 1 : null));
    void getDailyStreak().then((s) => setStreakDays(s?.days ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daily.data?.day]));

  const set = daily.data;
  const played = set?.already_played || (set && local?.day === set.day);
  const result = set?.result ?? (played && local ? local : null);
  const preparing = daily.isError && String((daily.error as Error)?.message ?? '').includes('daily_not_ready');

  const start = () => {
    track('daily_start', { daily_no: set?.number, resume: resume != null });
    router.push('/play/daily');
  };

  return (
    <Screen scroll>
      <Text style={styles.eyebrow}>{t('home.daily').toUpperCase()}</Text>
      {daily.isLoading && isConfigured ? (
        <>
          <Skeleton height={36} width="60%" style={{ marginTop: spacing.md }} />
          <Skeleton height={18} width="40%" style={{ marginTop: spacing.sm }} />
          <Skeleton height={120} round={radius.xl} style={{ marginTop: spacing.xl }} />
        </>
      ) : preparing || (!set && !daily.isError) ? (
        <View style={styles.card}>
          <Text style={styles.body}>{t('daily.preparing')}</Text>
          <Button title={t('common.retry')} variant="secondary" small onPress={() => { void daily.refetch(); }} style={{ marginTop: spacing.md }} />
        </View>
      ) : daily.isError ? (
        <View style={styles.card}>
          <Text style={styles.body}>{t('common.offline')}</Text>
          {local && <Text style={styles.muted}>{t('daily.pending_sync', { total: local.total })}</Text>}
          <Button title={t('common.retry')} variant="secondary" small onPress={() => { void daily.refetch(); }} style={{ marginTop: spacing.md }} />
        </View>
      ) : set ? (
        <>
          <Text style={styles.title}>{t('daily.title', { no: set.number })}</Text>
          <Text style={styles.muted}>{formatDay(set.day, lang)}</Text>
          <View style={styles.card}>
            <View style={styles.icons}>
              {set.rounds.map((r, i) => <Text key={`${r.id}-${i}`} style={styles.icon}>{GLYPH[r.category] ?? '📦'}</Text>)}
            </View>
            <Text style={styles.body}>{t('daily.rules')}</Text>
            {streakDays >= 2 && <Text style={styles.flame}>🔥 {t('daily.streak_days', { n: streakDays })}</Text>}
            {result ? (
              <>
                <Text style={styles.score}>{result.total} / 5 000</Text>
                <Text style={styles.grid}>{result.grid}</Text>
                <Button title={t('daily.view_result')} onPress={() => router.push('/daily/result')} style={{ marginTop: spacing.md }} />
              </>
            ) : (
              <Button title={resume ? t('daily.resume', { n: resume }) : t('home.play')} onPress={start} style={{ marginTop: spacing.lg }} />
            )}
            <CountdownText template={t('home.next_in', { time: '{time}' })} style={{ marginTop: spacing.md, textAlign: 'center' }} />
          </View>
          <Button title={t('leaderboard.title')} variant="ghost" onPress={() => router.push('/leaderboard')} style={{ marginTop: spacing.md }} />
          <Button title={t('daily.how_scored')} variant="ghost" onPress={() => { track('daily_info_tap'); router.push('/daily/info'); }} />
        </>
      ) : null}
    </Screen>
  );
}

const GLYPH: Record<string, string> = { flats: '🏢', houses: '🏠', cars: '🚗', random: '📦', land: '🌲' };

const styles = StyleSheet.create({
  eyebrow: { ...type.small, color: colors.accent, letterSpacing: 1, fontWeight: '700', marginTop: spacing.lg },
  title: { ...type.h1, color: colors.text, marginTop: spacing.xs },
  muted: { ...type.small, color: colors.textMuted, marginTop: 4 },
  card: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.xl, marginTop: spacing.xl, alignItems: 'center' },
  icons: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  icon: { fontSize: 28 },
  body: { ...type.body, color: colors.textMuted, textAlign: 'center' },
  flame: { ...type.body, color: colors.accent, marginTop: spacing.sm },
  score: { ...type.h1, color: colors.text, marginTop: spacing.lg, fontVariant: ['tabular-nums'] },
  grid: { fontSize: 24, marginTop: 4 },
});
