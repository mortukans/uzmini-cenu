/** Home (docs/11 §2.2): daily card, mode tiles, category + region picker, listing filters. */
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { countListings, getDaily, listCarMakes, listCarModels } from '../../src/api/rpc';
import { DEFAULT_FILTERS, LISTING_PERIODS, LISTING_SORTS, type CategoryFilter, type ListingFilters, type Region } from '../../src/api/types';
import { useAuth } from '../../src/auth/store';
import { describeSelection, isDefaultFilters, normalizeFilters } from '../../src/game/filters';
import { encodeSessionId } from '../../src/game/machine';
import { getDailyLocalResult, getPrefs, getStreakBests, isOnboarded, setPrefs, type StreakBests } from '../../src/game/storage';
import { isConfigured } from '../../src/env';
import { screenView, track } from '../../src/analytics';
import { haptic } from '../../src/ui/haptics';
import { Button, CountdownText, OptionSheet, Screen, Skeleton } from '../../src/ui/components';
import { colors, radius, spacing, type } from '../../src/ui/theme';

const CATEGORIES: CategoryFilter[] = ['flats', 'houses', 'cars', 'random', 'all'];
const REGIONS: Region[] = ['riga', 'riga_region', 'latvia'];
/** Below this many matching listings a solo/streak session cannot be played. */
const MIN_MATCHES = 3;

export default function HomeScreen() {
  const { t } = useTranslation();
  const profile = useAuth((a) => a.profile);
  // Per-user local state (streak bests, local daily result) and the daily query
  // are keyed by the auth user id: a link / restore / sign-out / delete must
  // never show the previous account's values (build 25 regression).
  const uid = useAuth((a) => a.session?.user.id ?? null);
  const [category, setCategory] = useState<CategoryFilter>('flats');
  const [region, setRegion] = useState<Region>('riga');
  const [filters, setFilters] = useState<ListingFilters>(DEFAULT_FILTERS);
  const [picker, setPicker] = useState<'make' | 'model' | null>(null);
  const [bests, setBests] = useState<StreakBests>({});
  const [local, setLocal] = useState<{ day: string; total: number; grid: string } | null>(null);

  const daily = useQuery({ queryKey: ['daily', uid], queryFn: getDaily, enabled: isConfigured, staleTime: 60_000 });

  // What the session will actually use: make/model only for cars.
  const effective = normalizeFilters(filters, category);
  const isCars = category === 'cars';

  const count = useQuery({
    queryKey: ['count', category, region, effective],
    queryFn: () => countListings(category, region, effective),
    enabled: isConfigured,
    staleTime: 30_000,
  });
  const makes = useQuery({
    queryKey: ['car_makes', region, effective.period],
    queryFn: () => listCarMakes(region, effective.period),
    enabled: isConfigured && isCars,
    staleTime: 5 * 60_000,
  });
  const models = useQuery({
    queryKey: ['car_models', effective.make ?? '', region, effective.period],
    queryFn: () => listCarModels(effective.make!, region, effective.period),
    enabled: isConfigured && isCars && Boolean(effective.make),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    void (async () => {
      if (!(await isOnboarded())) router.replace('/onboarding');
    })();
  }, []);

  useFocusEffect(useCallback(() => {
    screenView('home');
    void getPrefs().then((p) => { setCategory(p.category); setRegion(p.region); setFilters(p.filters); });
    // Re-read for the current uid (the callback re-runs when it changes while focused).
    setBests({}); setLocal(null);
    void getStreakBests().then(setBests);
    void getDailyLocalResult().then(setLocal);
    void daily.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]));

  const pick = (c: CategoryFilter) => {
    void haptic.step();
    setCategory(c);
    // Leaving cars drops make/model (storage does the same for the persisted prefs).
    setFilters((f) => normalizeFilters(f, c));
    void setPrefs({ category: c });
  };
  const pickRegion = (r: Region) => { void haptic.step(); setRegion(r); void setPrefs({ region: r }); };

  const setFilter = (patch: Partial<ListingFilters>) => {
    void haptic.step();
    const base: ListingFilters = { ...filters, ...patch };
    // A new make invalidates the model (models belong to a make).
    if ('make' in patch && (patch.make ?? null) !== (filters.make ?? null) && !('model' in patch)) delete base.model;
    const next = normalizeFilters(base, category);
    setFilters(next);
    track('home_filter_change', { ...patch, category });
    void setPrefs({ filters: next });
  };
  const resetFilters = () => {
    void haptic.step();
    setFilters({ ...DEFAULT_FILTERS });
    track('home_filter_reset', { category });
    void setPrefs({ filters: { ...DEFAULT_FILTERS } });
  };

  // Count: unknown (offline / loading / error) never blocks play; a known small count does.
  const notEnough = isConfigured && count.isSuccess && (count.data ?? 0) < MIN_MATCHES;
  const filtersActive = !isDefaultFilters(effective);

  const play = (mode: 'solo' | 'streak') => {
    if (notEnough) return;
    track('home_mode_tap', { mode, category, region, ...effective });
    router.push(`/play/${encodeSessionId(mode, category, region, effective)}`);
  };

  // Server truth first (`result` of get_daily for THIS user); the per-user local
  // result only covers an anonymous/offline play of today's set.
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

      {/* Filters */}
      <View style={styles.sectionRow}>
        <Text style={[styles.section, styles.sectionInline]}>{t('filters.title')}</Text>
        {filtersActive && (
          <Pressable onPress={resetFilters} hitSlop={8} accessibilityRole="button">
            <Text style={styles.reset}>{t('filters.reset')}</Text>
          </Pressable>
        )}
      </View>
      <View style={styles.chips}>
        {LISTING_PERIODS.map((p) => (
          <Pressable key={p} onPress={() => setFilter({ period: p })} style={[styles.chip, styles.chipSmall, effective.period === p && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: effective.period === p }}>
            <Text style={[styles.chipText, effective.period === p && styles.chipTextOn]}>{t(`filters.period.${p}`)}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.subLabel}>{t('filters.sort_label')}</Text>
      <View style={styles.chips}>
        {LISTING_SORTS.map((o) => (
          <Pressable key={o} onPress={() => setFilter({ sort: o })} style={[styles.chip, styles.chipSmall, effective.sort === o && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: effective.sort === o }}>
            <Text style={[styles.chipText, effective.sort === o && styles.chipTextOn]}>{t(`filters.sort.${o}`)}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.note}>{t('filters.sort_note')}</Text>

      {isCars && (
        <View style={styles.pickerRows}>
          <Pressable onPress={() => setPicker('make')} style={styles.pickerRow} accessibilityRole="button">
            <Text style={styles.pickerLabel}>{t('filters.make')}</Text>
            <Text style={[styles.pickerValue, effective.make && styles.pickerValueOn]} numberOfLines={1}>{effective.make ?? t('filters.any_make')} ▾</Text>
          </Pressable>
          <Pressable
            onPress={() => setPicker('model')}
            disabled={!effective.make}
            style={[styles.pickerRow, !effective.make && styles.pickerRowOff]}
            accessibilityRole="button"
            accessibilityState={{ disabled: !effective.make }}
          >
            <Text style={styles.pickerLabel}>{t('filters.model')}</Text>
            <Text style={[styles.pickerValue, effective.model && styles.pickerValueOn]} numberOfLines={1}>{effective.model ?? t('filters.any_model')} ▾</Text>
          </Pressable>
        </View>
      )}

      {isConfigured && (
        <View style={styles.matches}>
          {count.isLoading ? (
            <Skeleton height={14} width="45%" />
          ) : count.isSuccess ? (
            <Text style={[styles.matchesText, notEnough && styles.matchesLow]}>{t('filters.matches', { count: count.data ?? 0 })}</Text>
          ) : null}
          {notEnough && <Text style={styles.notEnough}>{t('filters.not_enough')}</Text>}
        </View>
      )}

      {/* Mode tiles */}
      <View style={styles.tiles}>
        <Pressable onPress={() => play('solo')} disabled={notEnough} style={[styles.tile, notEnough && styles.tileOff]} accessibilityRole="button" accessibilityState={{ disabled: notEnough }}>
          <Text style={styles.tileTitle}>{t('home.free_play')}</Text>
          <Text style={styles.tileSub} numberOfLines={2}>{describeSelection(category, region, effective, t)}</Text>
        </Pressable>
        <Pressable onPress={() => play('streak')} disabled={notEnough} style={[styles.tile, notEnough && styles.tileOff]} accessibilityRole="button" accessibilityState={{ disabled: notEnough }}>
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

      <OptionSheet
        visible={picker === 'make'}
        title={t('filters.make')}
        options={(makes.data ?? []).map((m) => ({ key: m.make, label: m.make, n: m.n }))}
        anyLabel={t('filters.any_make')}
        selected={effective.make ?? null}
        onSelect={(make) => setFilter({ make })}
        onClose={() => setPicker(null)}
        searchPlaceholder={t('filters.search')}
        loading={makes.isLoading}
        error={makes.isError}
        onRetry={() => { void makes.refetch(); }}
        retryLabel={t('common.retry')}
        errorLabel={t('common.error')}
        cancelLabel={t('common.cancel')}
      />
      <OptionSheet
        visible={picker === 'model'}
        title={effective.make ? `${effective.make} · ${t('filters.model')}` : t('filters.model')}
        options={(models.data ?? []).map((m) => ({ key: m.model, label: m.model, n: m.n }))}
        anyLabel={t('filters.any_model')}
        selected={effective.model ?? null}
        onSelect={(model) => setFilter({ model })}
        onClose={() => setPicker(null)}
        searchPlaceholder={t('filters.search')}
        loading={models.isLoading}
        error={models.isError}
        onRetry={() => { void models.refetch(); }}
        retryLabel={t('common.retry')}
        errorLabel={t('common.error')}
        cancelLabel={t('common.cancel')}
      />
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
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: spacing.xl, marginBottom: spacing.sm },
  sectionInline: { marginTop: 0, marginBottom: 0 },
  reset: { ...type.small, color: colors.accent, fontWeight: '600' },
  subLabel: { ...type.small, color: colors.textMuted, marginTop: spacing.xs, marginBottom: spacing.sm },
  note: { ...type.small, color: colors.textMuted, opacity: 0.8, marginTop: -spacing.xs, marginBottom: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, minHeight: 40, justifyContent: 'center' },
  chipSmall: { minHeight: 36, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipOff: { opacity: 0.5 },
  chipText: { ...type.body, color: colors.text, fontSize: 15 },
  chipTextOn: { color: colors.accentText, fontWeight: '700' },
  pickerRows: { gap: spacing.sm, marginTop: spacing.xs, marginBottom: spacing.sm },
  pickerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, minHeight: 48 },
  pickerRowOff: { opacity: 0.45 },
  pickerLabel: { ...type.body, color: colors.textMuted, fontSize: 15 },
  pickerValue: { ...type.body, color: colors.textMuted, fontSize: 15, flexShrink: 1, marginLeft: spacing.md, textAlign: 'right' },
  pickerValueOn: { color: colors.text, fontWeight: '600' },
  matches: { marginTop: spacing.xs, minHeight: 18, gap: spacing.xs },
  matchesText: { ...type.small, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  matchesLow: { color: colors.yellow },
  notEnough: { ...type.small, color: colors.yellow },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.md },
  tile: { width: '47.5%', backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, minHeight: 96, justifyContent: 'space-between' },
  tileOff: { opacity: 0.45 },
  tileTitle: { ...type.h3, color: colors.text },
  tileSub: { ...type.small, color: colors.textMuted, marginTop: spacing.sm },
  linkRow: { marginTop: spacing.xl, paddingVertical: spacing.sm },
  link: { ...type.body, color: colors.accent, fontWeight: '600' },
});
