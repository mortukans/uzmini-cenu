/** Daily result + share (docs/11 §2.8, share text per docs/02 §3.3). */
import { useEffect, useState } from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Clipboard from 'expo-clipboard';
import { useQuery } from '@tanstack/react-query';
import { myRank } from '../../src/api/rpc';
import { useAuth } from '../../src/auth/store';
import { env, isConfigured } from '../../src/env';
import { formatEur } from '../../src/game/format';
import { useSession } from '../../src/game/session';
import { getDailyLocalResult, getDailyStreak, type StoredOutcome } from '../../src/game/storage';
import { currentLang } from '../../src/i18n';
import { screenView, track } from '../../src/analytics';
import { haptic } from '../../src/ui/haptics';
import { Button, CountdownText, Screen } from '../../src/ui/components';
import { colors, gridColor, radius, spacing, type } from '../../src/ui/theme';

/** Exact three-line share text (docs/02 §3.3). */
export function buildShareText(number: number, total: number, grid: string, lang: 'lv' | 'ru' | 'en', streakDays: number, host = env.UNIVERSAL_LINK_HOST): string {
  const fmt = (n: number) => (lang === 'en' ? n.toLocaleString('en-US') : n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' '));
  const streak = streakDays >= 2 ? ` · 🔥${streakDays}` : '';
  return `Uzmini Cenu #${number} · ${fmt(total)} / ${fmt(5000)}${streak}\n${grid}\n${host}/d/${number}`;
}

export default function DailyResult() {
  const { t } = useTranslation();
  const lang = currentLang();
  const hasUsername = useAuth((a) => a.hasUsername);
  const session = useSession();
  const [local, setLocal] = useState<{ number: number; total: number; grid: string; outcomes: StoredOutcome[]; synced: boolean } | null>(null);
  const [streakDays, setStreakDays] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    screenView('daily_result');
    void getDailyLocalResult().then(setLocal);
    void getDailyStreak().then((s) => setStreakDays(s?.days ?? 0));
  }, [session.dailySubmitted]);

  const number = session.daily?.number ?? local?.number ?? 0;
  const total = session.dailySubmitted?.total ?? local?.total ?? 0;
  const grid = session.dailySubmitted?.grid ?? local?.grid ?? '';
  const outcomes: StoredOutcome[] = local?.outcomes ?? [];
  const synced = session.dailySubmitted?.synced ?? local?.synced ?? false;

  const globalRank = useQuery({ queryKey: ['myRank', 'global', 'day'], queryFn: () => myRank('global', 'day'), enabled: isConfigured && hasUsername && synced });
  const friendsRank = useQuery({ queryKey: ['myRank', 'friends', 'day'], queryFn: () => myRank('friends', 'day'), enabled: isConfigured && hasUsername && synced });

  const text = session.dailySubmitted?.shareText ?? buildShareText(number, total, grid, lang, streakDays);

  const share = async () => {
    track('daily_share_tap', { method: 'sheet' });
    void haptic.submit();
    try {
      const r = await Share.share({ message: text });
      if (r.action === Share.sharedAction) track('daily_share_complete', { activity: r.activityType ?? 'unknown' });
    } catch { /* cancelled */ }
  };

  const copy = async () => {
    track('daily_share_tap', { method: 'copy' });
    await Clipboard.setStringAsync(text);
    setCopied(true);
    void haptic.success();
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Screen scroll edges={['top', 'left', 'right', 'bottom']}>
      <Pressable onPress={() => router.dismissTo('/(tabs)')} hitSlop={12} style={styles.close} accessibilityRole="button" accessibilityLabel={t('common.close')}>
        <Text style={styles.closeText}>✕</Text>
      </Pressable>
      <Text style={styles.title}>{t('daily.title', { no: number })}</Text>
      <Text style={styles.total}>{total.toLocaleString(lang === 'en' ? 'en-US' : 'lv-LV')} / 5 000</Text>
      <Text style={styles.grid}>{grid}</Text>
      {streakDays >= 2 && <Text style={styles.flame}>🔥 {t('daily.streak_days', { n: streakDays })}</Text>}

      <View style={styles.rows}>
        {outcomes.map((o) => (
          <View key={o.round_no} style={styles.row}>
            <Text style={styles.rowNo}>{o.round_no}</Text>
            <Text style={styles.rowName} numberOfLines={1}>{o.location ?? o.title_hint ?? '—'}</Text>
            <Text style={styles.rowNum}>{formatEur(o.price, lang)}</Text>
            <Text style={[styles.rowScore, { color: gridColor(o.cell) }]}>{o.score}</Text>
          </View>
        ))}
      </View>

      <View style={styles.ranks}>
        {!hasUsername ? (
          <Pressable onPress={() => router.push('/sign-in')} accessibilityRole="button">
            <Text style={styles.link}>{t('daily.username_rank')}</Text>
          </Pressable>
        ) : !synced ? (
          <Text style={styles.muted}>{t('daily.unsynced')}</Text>
        ) : (
          <>
            {globalRank.data != null && <Text style={styles.muted}>{t('daily.rank_global', { rank: globalRank.data })}</Text>}
            {friendsRank.data != null && <Text style={styles.muted}>{t('daily.rank_friends', { rank: friendsRank.data })}</Text>}
          </>
        )}
      </View>

      <Button title={copied ? t('daily.copied') : t('daily.copy')} variant="secondary" onPress={() => { void copy(); }} style={{ marginTop: spacing.xl }} />
      <Button title={t('daily.share')} onPress={() => { void share(); }} style={{ marginTop: spacing.sm }} />
      <Button title={t('leaderboard.title')} variant="ghost" onPress={() => router.push('/leaderboard')} style={{ marginTop: spacing.sm }} />
      <CountdownText template={t('home.next_in', { time: '{time}' })} style={{ textAlign: 'center', marginTop: spacing.md }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  close: { alignSelf: 'flex-start', paddingVertical: spacing.sm },
  closeText: { color: colors.textMuted, fontSize: 22 },
  title: { ...type.h2, color: colors.textMuted, textAlign: 'center', marginTop: spacing.sm },
  total: { ...type.display, color: colors.text, textAlign: 'center', fontVariant: ['tabular-nums'] },
  grid: { fontSize: 32, textAlign: 'center', marginTop: spacing.xs },
  flame: { ...type.body, color: colors.accent, textAlign: 'center', marginTop: spacing.sm },
  rows: { marginTop: spacing.xl, gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  rowNo: { ...type.small, color: colors.textMuted, width: 18 },
  rowName: { ...type.body, color: colors.text, flex: 1, fontSize: 15 },
  rowNum: { ...type.small, color: colors.textMuted, fontVariant: ['tabular-nums'], width: 84, textAlign: 'right' },
  rowScore: { ...type.body, fontWeight: '700', fontVariant: ['tabular-nums'], width: 48, textAlign: 'right' },
  ranks: { marginTop: spacing.lg, gap: 4, alignItems: 'center' },
  muted: { ...type.body, color: colors.textMuted },
  link: { ...type.body, color: colors.accent, fontWeight: '600' },
});
