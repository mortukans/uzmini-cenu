/**
 * End-of-session summary for free play, streak and onboarding practice.
 * Extracted from app/play/[sessionId].tsx so the session review can grow
 * without touching the round screen. Rendered by the play route when the
 * session phase is SUMMARY (mode !== daily).
 *
 * Session review: every listing the player guessed on is listed
 * (`SessionReviewList`); tapping one opens `ListingReviewSheet` with the
 * original ad link and its current availability (`get_listing_status`).
 */
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { maxScore, totalScore, type Outcome } from '../../game/machine';
import { sessionActions, useSession } from '../../game/session';
import { setOnboarded } from '../../game/storage';
import { rigaDay } from '../../game/time';
import { currentLang } from '../../i18n';
import { screenView, track } from '../../analytics';
import { Button, ListingReviewSheet, Screen, SessionReviewList, headerFor, useListingAvailability, type ReviewItem } from '../components';
import { colors, spacing, type } from '../theme';

/** `Outcome` → the generic review row/sheet item. Exported for tests. */
export function reviewItemFor(o: Outcome, t: (k: string) => string): ReviewItem {
  const h = headerFor(o.round, t);
  return {
    id: o.round.id,
    category: o.round.category,
    title: h.title,
    subtitle: h.subtitle,
    photoUrls: o.round.photo_urls ?? [],
    attributes: o.round.attributes,
    guess: o.guess,
    price: o.price,
    score: o.score,
    cell: o.cell,
    sourceUrl: o.sourceUrl,
    source: o.round.source,
    roundNo: o.roundNo,
  };
}

export function SessionSummary({ isOnboarding, sessionId }: { isOnboarding: boolean; sessionId: string }) {
  const { t } = useTranslation();
  const { t: tr } = useTranslation('review');
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

  const items = useMemo(() => s.outcomes.map((o) => reviewItemFor(o, t)), [s.outcomes, t]);
  const ids = useMemo(() => items.map((i) => i.id), [items]);
  // Onboarding practice rounds are a local fixture set: never ask the server about them.
  const availability = useListingAvailability(isOnboarding ? [] : ids);
  const [selected, setSelected] = useState<ReviewItem | null>(null);

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

  const review = (item: ReviewItem) => {
    track('review_open_item', { listing_id: item.id, mode: cfg?.mode, status: availability[item.id]?.status ?? 'unknown' });
    setSelected(item);
  };

  const sheet = (
    <ListingReviewSheet item={selected} availability={selected ? availability[selected.id] : undefined} onClose={() => setSelected(null)} />
  );

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
        {items.length > 0 && (
          <SessionReviewList
            items={items}
            availability={availability}
            onPress={review}
            highlightId={last?.round.id}
            highlightLabel={tr('final_miss')}
          />
        )}
        <Button title={t('streak.try_again')} onPress={playAgain} style={{ marginTop: spacing.xl }} />
        <Button title={t('common.home')} variant='ghost' onPress={home} style={{ marginTop: spacing.sm }} />
        {sheet}
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
      {items.length > 0 && <SessionReviewList items={items} availability={availability} onPress={review} />}
      <Button title={t('summary.play_again')} onPress={playAgain} style={{ marginTop: spacing.xl }} />
      <Button title={t('common.home')} variant='ghost' onPress={home} style={{ marginTop: spacing.sm }} />
      <Text style={styles.dayFoot}>{rigaDay()}</Text>
      {sheet}
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
  dayFoot: { ...type.small, color: colors.border, textAlign: 'center', marginTop: spacing.xl },
});
