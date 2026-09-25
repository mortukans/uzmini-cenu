/**
 * THE round screen, used by every mode (docs/11 §2.4-2.6). sessionId encodes
 * mode+params (`solo:flats:riga`, `streak:all`, `daily`, `onboarding`) or is
 * `duel:<id>` / `room:<code>` when the social side has already started the
 * session store.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as WebBrowser from 'expo-web-browser';

import { formatEur } from '../../src/game/format';
import { availableHints, type HintType, PHOTOS_BEFORE_HINT } from '../../src/game/hints';
import { derivedValue } from '../../src/game/keypad';
import { isLastRound, maxScore, parseSessionId, totalScore, type Outcome } from '../../src/game/machine';
import { sessionActions, useSession } from '../../src/game/session';
import { getStreakBests, getStreakCurrent, isOnboarded, setOnboarded } from '../../src/game/storage';
import { rigaDay } from '../../src/game/time';
import { currentLang } from '../../src/i18n';
import { adsAvailable, preloadInterstitial, preloadRewarded, shouldShowInterstitial, showInterstitial, showRewarded } from '../../src/monetization/ads';
import { screenView, track } from '../../src/analytics';
import { haptic } from '../../src/ui/haptics';
import { AttributeChips, Button, Keypad, PhotoCarousel, RevealCard, Screen, Skeleton, headerFor } from '../../src/ui/components';
import { colors, gridColor, radius, spacing, type } from '../../src/ui/theme';

export default function PlayScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const { t } = useTranslation();
  const lang = currentLang();
  const s = useSession();
  // Free app, no paid tier: nobody is premium (ads stay behind env.ADS_ENABLED).
  const isPremium = false;

  const parsed = useMemo(() => parseSessionId(sessionId ?? 'solo:all'), [sessionId]);
  const isOnboarding = sessionId === 'onboarding';
  const [guess, setGuess] = useState(0);
  const [hintSheet, setHintSheet] = useState(false);
  const [hintBusy, setHintBusy] = useState(false);
  const [firstSession, setFirstSession] = useState(false);
  const [now, setNow] = useState(Date.now());

  const round = s.rounds[0];
  const cfg = s.config;
  const mode = cfg?.mode ?? parsed.mode;

  // Start (or reuse) the session for solo/streak/daily. Duel/room and onboarding are started elsewhere.
  useEffect(() => {
    screenView('play');
    if (!sessionId || isOnboarding) return;
    if (s.config?.sessionId === sessionId && s.phase !== 'SUMMARY') return;
    if (parsed.mode === 'duel' || parsed.mode === 'room') return;
    void (async () => {
      let streak = 0;
      if (parsed.mode === 'streak') {
        const cur = await getStreakCurrent();
        if (cur && cur.category === parsed.category) streak = cur.length;
        const bests = await getStreakBests();
        useSession.setState({ streakBest: bests[parsed.category] ?? 0 });
      }
      setFirstSession(!(await isOnboarded()));
      await sessionActions.startSession({ mode: parsed.mode, category: parsed.category, region: parsed.region, sessionId, streak });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Every round starts empty (docs/02 §1.2).
  useEffect(() => { setGuess(0); }, [round?.id, s.roundNo]);

  // Ads: preload at round 3, show every 5th round after the score has landed.
  useEffect(() => {
    if (mode !== 'solo' && mode !== 'streak') return;
    if (s.roundNo === 3 && !isPremium) void preloadInterstitial();
    if (!isPremium && cfg?.allowHints) void preloadRewarded();
  }, [s.roundNo, isPremium, mode, cfg?.allowHints]);

  // Timer tick for duel/room.
  useEffect(() => {
    if (!cfg?.timerSec) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [cfg?.timerSec]);

  // Daily → result screen on completion.
  useEffect(() => {
    if (s.phase === 'SUMMARY' && mode === 'daily') router.replace('/daily/result');
  }, [s.phase, mode]);

  const onSubmit = useCallback(() => {
    if (s.phase !== 'GUESSING') return;
    sessionActions.submit(guess);
  }, [guess, s.phase]);

  const onNext = useCallback(async () => {
    if (mode === 'solo' && !isOnboarding && (await shouldShowInterstitial(s.roundNo, isPremium, firstSession))) {
      await showInterstitial();
    }
    sessionActions.next();
  }, [mode, s.roundNo, isPremium, firstSession, isOnboarding]);

  const confirmClose = () => {
    const needsConfirm = mode === 'daily' || mode === 'duel' || mode === 'room';
    const leave = () => { if (mode === 'solo' || mode === 'streak') sessionActions.reset(); router.back(); };
    if (!needsConfirm || s.phase === 'SUMMARY') return leave();
    Alert.alert(t('round.leave_title'), t('round.leave_body'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('round.leave_confirm'), style: 'destructive', onPress: leave },
    ]);
  };

  const openListing = (url: string) => {
    track('reveal_open_listing', { listing_id: round?.id });
    WebBrowser.openBrowserAsync(url).catch(() => Linking.openURL(url));
  };

  // ─── hints ────────────────────────────────────────────────────────────────
  const hintOptions = round && cfg ? availableHints({
    mode, used: s.hintsUsed, hasTitle: Boolean(round.title_hint), photoCount: round.photo_urls.length, bracketSupported: false,
  }) : [];

  const takeHint = async (h: HintType) => {
    setHintBusy(true);
    try {
      let paid = await sessionActions.spendHintToken();
      if (!paid && adsAvailable()) paid = await showRewarded('hint_rewarded');
      if (!paid && !adsAvailable()) paid = true; // ads off: hints are free
      if (paid) sessionActions.useHint(h);
    } finally {
      setHintBusy(false);
      setHintSheet(false);
    }
  };

  // ─── render helpers ───────────────────────────────────────────────────────
  const headerRight = () => {
    if (cfg?.timerSec && s.deadlineAt && (s.phase === 'GUESSING' || s.phase === 'STAGED' || s.phase === 'WAITING_OTHERS')) {
      const left = Math.max(0, Math.ceil((s.deadlineAt - now) / 1000));
      const color = left <= 5 ? colors.red : left <= 10 ? colors.yellow : colors.text;
      if (left === 5) void haptic.heavy();
      return <Text style={[styles.headerScore, { color }]}>{`0:${String(left).padStart(2, '0')}`}</Text>;
    }
    if (mode === 'streak') return <Text style={styles.headerScore}>{t('streak.current', { n: s.streak })}</Text>;
    return <Text style={styles.headerScore}>{t('round.points_short', { n: totalScore(s) })}</Text>;
  };

  const roundCounter = cfg?.totalRounds
    ? t('round.round_of', { n: s.roundNo, total: cfg.totalRounds })
    : t('round.round_n', { n: s.roundNo });

  if (s.phase === 'SUMMARY' && mode !== 'daily') {
    return <Summary isOnboarding={isOnboarding} sessionId={sessionId ?? ''} />;
  }

  const derived = round && s.lastOutcome ? derivedValue(s.lastOutcome.price, round.category, round.attributes) : null;
  const derivedStr = derived ? (derived.kind === 'per_m2' ? t('keypad.per_m2', { value: formatEur(derived.value, lang) }) : t('keypad.per_ha', { value: formatEur(derived.value, lang) })) : null;

  return (
    <Screen padded={false} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={confirmClose} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('common.close')}>
          <Text style={styles.close}>✕</Text>
        </Pressable>
        <Text style={styles.counter}>{roundCounter}</Text>
        {headerRight()}
      </View>

      {s.offline && <View style={styles.banner}><Text style={styles.bannerText}>{t('common.offline_solo')}</Text></View>}

      {(s.phase === 'LOADING' || !round) && s.phase !== 'ERROR' && (
        <View style={styles.body}>
          <Skeleton height={260} round={radius.lg} />
          <Skeleton width="60%" height={22} style={{ marginTop: spacing.lg }} />
          <Skeleton width="85%" height={18} style={{ marginTop: spacing.sm }} />
        </View>
      )}

      {s.phase === 'ERROR' && (
        <View style={[styles.body, styles.center]}>
          <Text style={styles.errorTitle}>{s.error === 'empty_pool' ? t('round.empty_pool') : s.error === 'network' ? t('common.offline') : t('round.submit_failed')}</Text>
          <Button title={t('common.retry')} onPress={() => sessionActions.retry()} style={styles.errorBtn} />
          <Button title={t('common.back')} variant="ghost" onPress={() => { sessionActions.reset(); router.back(); }} />
        </View>
      )}

      {round && (s.phase === 'STAGED' || s.phase === 'GUESSING' || s.phase === 'SUBMITTING') && (
        <View style={styles.playBody}>
          <ScrollView style={styles.top} contentContainerStyle={styles.topContent} bounces={false} showsVerticalScrollIndicator={false}>
            <PhotoCarousel
              urls={round.photo_urls}
              category={round.category}
              source={t('reveal.source', { source: round.source })}
              listingId={round.id}
              visibleCount={cfg?.allowHints && !s.hintsUsed.includes('photo') ? PHOTOS_BEFORE_HINT : undefined}
              height={220}
            />
            <ListingHeader round={round} />
            <AttributeChips listing={round} />
            {s.hintsUsed.includes('title') && round.title_hint ? <Text style={styles.titleHint}>“{round.title_hint}”</Text> : null}
            {cfg?.allowHints && hintOptions.length > 0 && s.phase === 'GUESSING' && (
              <View style={styles.actionsRow}>
                <Pressable onPress={() => setHintSheet(true)} style={styles.hintBtn} accessibilityRole="button">
                  <Text style={styles.hintText}>💡 {t('round.hint')}{s.hintTokens > 0 ? ` · ${s.hintTokens}` : ''}</Text>
                </Pressable>
                {cfg.allowSkip && s.skipsUsed < 2 && (
                  <Pressable onPress={() => sessionActions.skip()} style={styles.hintBtn} accessibilityRole="button">
                    <Text style={styles.hintText}>{t('round.skip')} ({2 - s.skipsUsed})</Text>
                  </Pressable>
                )}
              </View>
            )}
          </ScrollView>
          <View style={styles.keypadWrap}>
            <Keypad
              value={guess}
              onChange={setGuess}
              onSubmit={onSubmit}
              category={cfg?.category ?? 'all'}
              listingCategory={round.category}
              attributes={round.attributes}
              disabled={s.phase !== 'GUESSING'}
              submitting={s.phase === 'SUBMITTING'}
            />
            {s.error && s.phase === 'SUBMITTING' ? <Text style={styles.inlineError}>{t('round.submit_retrying')}</Text> : null}
          </View>
        </View>
      )}

      {round && s.phase === 'WAITING_OTHERS' && (
        <View style={[styles.body, styles.center]}>
          <Text style={styles.asking}>{t('round.asking')}</Text>
          <Text style={styles.hiddenPrice}>▒▒▒▒▒ €</Text>
          <Text style={styles.waiting}>{t('round.waiting_others')}</Text>
          <Text style={styles.yourGuess}>{t('reveal.your_guess')}: {formatEur(s.pendingGuess ?? 0, lang)}</Text>
        </View>
      )}

      {round && s.lastOutcome && (s.phase === 'REVEALING' || s.phase === 'REVEALED') && (
        <ScrollView style={styles.top} contentContainerStyle={styles.revealContent} showsVerticalScrollIndicator={false}>
          <RevealCard
            outcome={s.lastOutcome}
            animate={s.phase === 'REVEALING'}
            onAnimationDone={() => sessionActions.revealDone()}
            derived={derivedStr}
          />
          {s.phase === 'REVEALED' && (
            <>
              <View style={styles.revealMeta}>
                {round.title_hint ? <Text style={styles.titleHint}>“{round.title_hint}”</Text> : null}
                <AttributeChips listing={round} reveal compact />
                <Text style={styles.sourceLine}>{t('reveal.source', { source: round.source })}</Text>
              </View>
              {mode === 'streak' && s.streakOver && (
                <Text style={styles.streakOver}>{t('streak.over')}</Text>
              )}
              <Button title={t('reveal.open_listing')} variant="secondary" onPress={() => openListing(s.lastOutcome!.sourceUrl)} />
              <Button
                title={isLastRound(s) || s.streakOver ? t('reveal.result') : t('reveal.next')}
                onPress={() => { void onNext(); }}
                style={{ marginTop: spacing.sm }}
              />
            </>
          )}
        </ScrollView>
      )}

      <Modal visible={hintSheet} transparent animationType="slide" onRequestClose={() => setHintSheet(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setHintSheet(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{t('hint.sheet_title')}</Text>
            <Text style={styles.sheetSub}>
              {s.hintTokens > 0 ? t('hint.cost_token', { n: s.hintTokens }) : adsAvailable() ? t('hint.cost_ad') : t('hint.cost_free')}
            </Text>
            {hintOptions.map((h) => (
              <Button key={h} title={t(`hint.${h}`)} variant="secondary" loading={hintBusy} onPress={() => { void takeHint(h); }} style={{ marginTop: spacing.sm }} />
            ))}
            <Button title={t('common.cancel')} variant="ghost" onPress={() => setHintSheet(false)} style={{ marginTop: spacing.sm }} />
          </View>
        </Pressable>
      </Modal>
    </Screen>
  );
}

function ListingHeader({ round }: { round: { category: import('../../src/api/types').Category; attributes: import('../../src/api/types').ListingAttributes; location: string | null } }) {
  const { t } = useTranslation();
  const h = headerFor(round, t);
  return (
    <View style={styles.listingHeader}>
      <Text style={styles.listingTitle} numberOfLines={1}>{h.title.toUpperCase()}{h.subtitle ? ` · ${h.subtitle}` : ''}</Text>
    </View>
  );
}

// ─── summary (free play / streak over / onboarding) ──────────────────────────

function Summary({ isOnboarding, sessionId }: { isOnboarding: boolean; sessionId: string }) {
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
          <Text style={styles.big}>{t('onboarding.started_with', { n: total })}</Text>
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
        <Button title={t('common.home')} variant="ghost" onPress={home} style={{ marginTop: spacing.sm }} />
      </Screen>
    );
  }

  return (
    <Screen scroll edges={['top', 'left', 'right', 'bottom']}>
      <Text style={styles.summaryEyebrow}>{t('summary.title')}</Text>
      <Text style={styles.big}>{max ? t('summary.total', { n: total.toLocaleString(lang === 'en' ? 'en-US' : 'lv-LV'), max: max.toLocaleString(lang === 'en' ? 'en-US' : 'lv-LV') }) : total}</Text>
      <Text style={styles.summarySub}>{t('summary.avg', { n: avg })}</Text>
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
      <Button title={t('common.home')} variant="ghost" onPress={home} style={{ marginTop: spacing.sm }} />
      <Text style={styles.dayFoot}>{rigaDay()}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  close: { color: colors.textMuted, fontSize: 22, width: 32 },
  counter: { ...type.body, color: colors.textMuted },
  headerScore: { ...type.body, color: colors.text, fontWeight: '600', fontVariant: ['tabular-nums'], minWidth: 64, textAlign: 'right' },
  banner: { backgroundColor: colors.surfaceAlt, paddingVertical: 6, alignItems: 'center' },
  bannerText: { ...type.small, color: colors.yellow },
  body: { flex: 1, paddingHorizontal: spacing.lg },
  center: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  playBody: { flex: 1, justifyContent: 'space-between' },
  top: { flexGrow: 0, flexShrink: 1 },
  topContent: { paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: spacing.sm },
  keypadWrap: { paddingTop: spacing.xs },
  listingHeader: { marginTop: spacing.xs },
  listingTitle: { ...type.h3, color: colors.text, letterSpacing: 0.5 },
  titleHint: { ...type.body, color: colors.textMuted, fontStyle: 'italic' },
  actionsRow: { flexDirection: 'row', gap: spacing.sm },
  hintBtn: { paddingVertical: 6, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  hintText: { ...type.small, color: colors.accent, fontWeight: '600' },
  inlineError: { ...type.small, color: colors.yellow, textAlign: 'center', paddingBottom: spacing.xs },
  errorTitle: { ...type.h3, color: colors.text, textAlign: 'center' },
  errorBtn: { alignSelf: 'stretch', marginTop: spacing.lg },
  asking: { ...type.small, color: colors.textMuted, textTransform: 'uppercase' },
  hiddenPrice: { ...type.display, color: colors.textMuted },
  waiting: { ...type.body, color: colors.text, marginTop: spacing.lg },
  yourGuess: { ...type.body, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  revealContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md },
  revealMeta: { gap: spacing.sm },
  sourceLine: { ...type.small, color: colors.textMuted },
  streakOver: { ...type.h2, color: colors.red, textAlign: 'center' },
  sheetBackdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.xl, paddingBottom: spacing.xxl },
  sheetTitle: { ...type.h2, color: colors.text },
  sheetSub: { ...type.small, color: colors.textMuted, marginTop: spacing.xs, marginBottom: spacing.sm },
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
