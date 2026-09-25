/** Home (docs/11 §2.2): daily card, mode tiles, category + region picker. */
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { getDaily } from '../../src/api/rpc';
import type { CategoryFilter, Region } from '../../src/api/types';
import { useAuth } from '../../src/auth/store';
import { encodeSessionId } from '../../src/game/machine';
import { getDailyLocalResult, getPrefs, getStreakBests, isOnboarded, setPrefs, type StreakBests } from '../../src/game/storage';
import { isConfigured } from '../../src/env';
import { screenView, track } from '../../src/analytics';
import { haptic } from '../../src/ui/haptics';
import { Button, CountdownText, Screen, Skeleton } from '../../src/ui/components';
import { colors, radius, spacing, type } from '../../src/ui/theme';

const CATEGORIES: CategoryFilter[] = ['flats', 'houses', 'cars', 'random', 'all'];
const REGIONS: Region[] = ['riga', 'riga_region', 'latvia'];

export default function HomeScreen() {
  const { t } = useTranslation();
  const profile = useAuth((a) => a.profile);
  const [category, setCategory] = useState<CategoryFilter>('flats');
  const [region, setRegion] = useState<Region>('riga');
  const [bests, setBests] = useState<StreakBests>({});
  const [local, setLocal] = useState<{ day: string; total: number; grid: string } | null>(null);

  const daily = useQuery({ queryKey: ['daily'], queryFn: getDaily, enabled: isConfigured, staleTime: 60_000 });

  useEffect(() => {
    void (async () => {
      if (!(await isOnboarded())) router.replace('/onboarding');
    })();
  }, []);

  useFocusEffect(useCallback(() => {
    screenView('home');
    void getPrefs().then((p) => { setCategory(p.category); setRegion(p.region); });
    void getStreakBests().then(setBests);
    void getDailyLocalResult().then(setLocal);
    void daily.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []));

  const pick = (c: CategoryFilter) => { void haptic.step(); setCategory(c); void setPrefs({ category: c }); };
  const pickRegion = (r: Region) => { void haptic.step(); setRegion(r); void setPrefs({ region: r }); };

  const play = (mode: 'solo' | 'streak') => {
    track('home_mode_tap', { mode, category, region });
    router.push(`/play/${encodeSessionId(mode, category, region)}`);
  };

  // Server says played, or an anonymous/offline local result exists for today's set.
  const localIsToday = Boolean(local && daily.data && local.day === daily.data.day);
  const dailyResult = daily.data?.result ?? (localIsToday ? local : null);

  const onDaily = () => {
    track('home_daily_tap', { state: dailyResult ? 'played' : daily.isError ? 'error' : 'not_played' });
    if (dailyResult) router.push('/daily/result');
    else router.push('/daily');
  };

  return (
    <Screen scroll>
      <View style={styles.topbar}>
        <Text style={styles.brand}>Uzmini Cenu</Text>
        <Pressable onPress={() => router.push('/profile')} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('tabs.profile')}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{(profile?.username ?? '?').slice(0, 1).toUpperCase()}</Text>
          </View>
        </Pressable>
      </View>

      {/* Daily card */}
      <View style={styles.dailyCard}>
        <View style={styles.dailyHead}>
          <Text style={styles.dailyEyebrow}>{t('home.daily').toUpperCase()}</Text>
          {daily.data && <Text style={styles.dailyNo}>#{daily.data.number}</Text>}
        </View>
        {daily.isLoading && isConfigured ? (
          <>
            <Skeleton height={20} width="50%" />
            <Skeleton height={56} round={radius.lg} style={{ marginTop: spacing.md }} />
          </>
        ) : daily.isError ? (
          <>
            <Text style={styles.dailySub}>{t('home.daily_error')}</Text>
            <Button title={t('common.retry')} variant="secondary" small onPress={() => { void daily.refetch(); }} style={{ marginTop: spacing.md }} />
          </>
        ) : dailyResult ? (
          <>
            <Text style={styles.dailyScore}>{dailyResult.total} / 5 000</Text>
            <Text style={styles.dailyGrid}>{dailyResult.grid}</Text>
            <Button title={t('home.daily_done')} variant="secondary" onPress={onDaily} style={{ marginTop: spacing.md }} />
          </>
        ) : (
          <>
            <Text style={styles.dailySub}>{t('daily.rules')}</Text>
            <Button title={t('home.play_today')} onPress={onDaily} style={{ marginTop: spacing.md }} />
          </>
        )}
        <CountdownText template={t('home.next_in', { time: '{time}' })} style={{ marginTop: spacing.sm }} />
      </View>

      {/* Picker */}
      <Text style={styles.section}>{t('home.category')}</Text>
      <View style={styles.chips}>
        {CATEGORIES.map((c) => (
          <Pressable key={c} onPress={() => pick(c)} style={[styles.chip, category === c && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: category === c }}>
            <Text style={[styles.chipText, category === c && styles.chipTextOn]}>{t(`category.${c}`)}</Text>
          </Pressable>
        ))}
        <View style={[styles.chip, styles.chipOff]}><Text style={[styles.chipText, { color: colors.border }]}>{t('category.land')} · {t('common.soon')}</Text></View>
      </View>
      <View style={styles.chips}>
        {REGIONS.map((r) => (
          <Pressable key={r} onPress={() => pickRegion(r)} style={[styles.chip, region === r && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: region === r }}>
            <Text style={[styles.chipText, region === r && styles.chipTextOn]}>{t(`region.${r}`)}</Text>
          </Pressable>
        ))}
      </View>

      {/* Mode tiles */}
      <View style={styles.tiles}>
        <Pressable onPress={() => play('solo')} style={styles.tile} accessibilityRole="button">
          <Text style={styles.tileTitle}>{t('home.free_play')}</Text>
          <Text style={styles.tileSub}>{t(`category.${category}`)} · {t(`region.${region}`)}</Text>
        </Pressable>
        <Pressable onPress={() => play('streak')} style={styles.tile} accessibilityRole="button">
          <Text style={styles.tileTitle}>{t('home.streak')}</Text>
          <Text style={styles.tileSub}>{t('streak.best', { n: bests[category] ?? 0 })}</Text>
        </Pressable>
        <Pressable onPress={() => { track('home_mode_tap', { mode: 'duel' }); router.push('/friends'); }} style={styles.tile} accessibilityRole="button">
          <Text style={styles.tileTitle}>{t('home.duel')}</Text>
          <Text style={styles.tileSub}>{t('home.duel_sub')}</Text>
        </Pressable>
        <View style={[styles.tile, styles.tileOff]}>
          <Text style={styles.tileTitle}>{t('home.room')}</Text>
          <Text style={styles.tileSub}>{t('common.soon')}</Text>
        </View>
      </View>

      <Pressable onPress={() => { track('home_leaderboard_tap'); router.push('/leaderboard'); }} style={styles.linkRow} accessibilityRole="link">
        <Text style={styles.link}>{t('leaderboard.title')} →</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.md },
  brand: { ...type.h1, color: colors.text },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...type.h3, color: colors.text },
  dailyCard: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg, marginTop: spacing.sm },
  dailyHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
  dailyEyebrow: { ...type.small, color: colors.accent, letterSpacing: 1, fontWeight: '700' },
  dailyNo: { ...type.small, color: colors.textMuted },
  dailySub: { ...type.body, color: colors.textMuted },
  dailyScore: { ...type.h1, color: colors.text, fontVariant: ['tabular-nums'] },
  dailyGrid: { fontSize: 22, marginTop: 4 },
  section: { ...type.small, color: colors.textMuted, marginTop: spacing.xl, marginBottom: spacing.sm, textTransform: 'uppercase', letterSpacing: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, minHeight: 40, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipOff: { opacity: 0.5 },
  chipText: { ...type.body, color: colors.text, fontSize: 15 },
  chipTextOn: { color: colors.accentText, fontWeight: '700' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.md },
  tile: { width: '47.5%', backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, minHeight: 96, justifyContent: 'space-between' },
  tileOff: { opacity: 0.45 },
  tileTitle: { ...type.h3, color: colors.text },
  tileSub: { ...type.small, color: colors.textMuted, marginTop: spacing.sm },
  linkRow: { marginTop: spacing.xl, paddingVertical: spacing.sm },
  link: { ...type.body, color: colors.accent, fontWeight: '600' },
});
