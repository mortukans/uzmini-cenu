/** Leaderboard (docs/11 §2.9): global/friends × day/week/all. */
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { leaderboard, myRank } from '../src/api/rpc';
import type { LeaderboardRow } from '../src/api/types';
import { useAuth } from '../src/auth/store';
import { isConfigured } from '../src/env';
import { screenView, track } from '../src/analytics';
import { Button, Screen, Skeleton } from '../src/ui/components';
import { colors, radius, spacing, type } from '../src/ui/theme';

type Scope = 'global' | 'friends';
type Period = 'day' | 'week' | 'all';

export default function LeaderboardScreen() {
  const { t } = useTranslation();
  const hasUsername = useAuth((a) => a.hasUsername);
  const [scope, setScope] = useState<Scope>('global');
  const [period, setPeriod] = useState<Period>('day');

  useEffect(() => { screenView('leaderboard'); track('leaderboard_view', { scope, period }); }, [scope, period]);

  const board = useQuery({ queryKey: ['leaderboard', scope, period], queryFn: () => leaderboard(scope, period), enabled: isConfigured });
  const rank = useQuery({ queryKey: ['myRank', scope, period], queryFn: () => myRank(scope, period), enabled: isConfigured && hasUsername });

  const meInList = board.data?.some((r) => r.is_me) ?? false;

  const Seg = <T extends string>({ value, options, onChange }: { value: T; options: T[]; onChange: (v: T) => void; labelKey: string }) => (
    <View style={styles.seg}>
      {options.map((o) => (
        <Pressable key={o} onPress={() => onChange(o)} style={[styles.segItem, value === o && styles.segOn]} accessibilityRole="button" accessibilityState={{ selected: value === o }}>
          <Text style={[styles.segText, value === o && styles.segTextOn]}>{t(`leaderboard.${o}`)}</Text>
        </Pressable>
      ))}
    </View>
  );

  const renderRow = ({ item }: { item: LeaderboardRow }) => (
    <Pressable onPress={() => track('leaderboard_row_tap', { rank: item.rank })} style={[styles.row, item.is_me && styles.rowMe]}>
      <Text style={styles.rank}>{item.rank}</Text>
      <View style={styles.avatar}><Text style={styles.avatarText}>{(item.username ?? '?').slice(0, 1).toUpperCase()}</Text></View>
      <Text style={[styles.name, item.is_me && styles.nameMe]} numberOfLines={1}>{item.is_me ? t('leaderboard.you') : item.username}</Text>
      <Text style={styles.total}>{item.total.toLocaleString('lv-LV')}</Text>
    </Pressable>
  );

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('leaderboard.title')}</Text>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('common.close')}>
          <Text style={styles.close}>✕</Text>
        </Pressable>
      </View>
      <Seg value={period} options={['day', 'week', 'all'] as Period[]} onChange={setPeriod} labelKey="period" />
      <Seg value={scope} options={['global', 'friends'] as Scope[]} onChange={setScope} labelKey="scope" />

      {!hasUsername && (
        <Pressable onPress={() => router.push('/sign-in')} style={styles.banner} accessibilityRole="button">
          <Text style={styles.bannerText}>{t('leaderboard.username_banner')}</Text>
        </Pressable>
      )}

      {board.isLoading && isConfigured ? (
        <View style={{ gap: 8, marginTop: spacing.md }}>
          {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} height={52} round={radius.md} />)}
        </View>
      ) : board.isError ? (
        <View style={styles.center}>
          <Text style={styles.muted}>{t('leaderboard.error')}</Text>
          <Button title={t('common.retry')} variant="secondary" small onPress={() => { void board.refetch(); }} />
        </View>
      ) : (board.data?.length ?? 0) === 0 ? (
        <View style={styles.center}>
          <Text style={styles.muted}>{scope === 'friends' ? t('leaderboard.no_friends') : t('leaderboard.empty')}</Text>
          {scope === 'friends' && <Button title={t('leaderboard.add_friends')} variant="secondary" small onPress={() => router.push('/friends')} />}
        </View>
      ) : (
        <FlatList data={board.data} keyExtractor={(r) => r.user_id} renderItem={renderRow} contentContainerStyle={{ gap: 6, paddingTop: spacing.md, paddingBottom: spacing.xl }} showsVerticalScrollIndicator={false} />
      )}

      {hasUsername && !meInList && rank.data != null && (
        <View style={[styles.row, styles.rowMe, styles.pinned]}>
          <Text style={styles.rank}>{rank.data}</Text>
          <Text style={[styles.name, styles.nameMe]}>{t('leaderboard.you')}</Text>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.md },
  title: { ...type.h1, color: colors.text },
  close: { color: colors.textMuted, fontSize: 22 },
  seg: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.md, padding: 3, marginTop: spacing.sm },
  segItem: { flex: 1, paddingVertical: 9, borderRadius: radius.sm, alignItems: 'center' },
  segOn: { backgroundColor: colors.surfaceAlt },
  segText: { ...type.small, color: colors.textMuted, fontSize: 14 },
  segTextOn: { color: colors.text, fontWeight: '700' },
  banner: { marginTop: spacing.md, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.md },
  bannerText: { ...type.small, color: colors.accent, textAlign: 'center', fontWeight: '600' },
  center: { alignItems: 'center', gap: spacing.md, marginTop: spacing.xxl },
  muted: { ...type.body, color: colors.textMuted, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, minHeight: 52 },
  rowMe: { borderWidth: 1, borderColor: colors.accent },
  pinned: { marginBottom: spacing.md },
  rank: { ...type.body, color: colors.textMuted, width: 32, fontVariant: ['tabular-nums'] },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...type.small, color: colors.text, fontWeight: '700' },
  name: { ...type.body, color: colors.text, flex: 1 },
  nameMe: { color: colors.accent, fontWeight: '700' },
  total: { ...type.body, color: colors.text, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
