/**
 * Reveal payoff (docs/11 §2.5): price count-up over 1.2 s, then the score pops
 * in with its grid colour. Tap anywhere to skip the animation. Respects
 * Reduce Motion (fade instead of count-up).
 *
 * The €/m² (or €/ha) line is derived from the *animated* value so it counts
 * up with the price; once settled it is `derivedValue(outcome.price)` exactly,
 * so it can never drift from what the keypad showed. The timing is cancelable:
 * a re-render with a new round restarts it from 0, `animate` flipping to false
 * settles it, and unmount cancels it, so it is never left mid-way.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing, cancelAnimation, runOnJS, useAnimatedReaction, useReducedMotion, useSharedValue, withSpring, withTiming,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import type { Outcome } from '../../game/machine';
import { REVEAL_ANIM_MS } from '../../game/machine';
import { formatEur, formatPercent } from '../../game/format';
import { derivedValue } from '../../game/keypad';
import { currentLang } from '../../i18n';
import { haptic } from '../haptics';
import { colors, gridColor, radius, spacing, type } from '../theme';
import { ScoreBar } from './ScoreBar';

interface Props {
  outcome: Outcome;
  /** REVEALING → animate; REVEALED → static. */
  animate: boolean;
  onAnimationDone: () => void;
  /**
   * Fallback €/m² text for callers whose outcome carries no area. The card
   * derives the live value from `outcome.round` itself, so the play screen
   * can drop this prop.
   */
  derived?: string | null;
  /** Duel/room: named markers for other players. */
  otherNames?: Record<string, string>;
}

/** Height reserved for the score box so the rows below never jump when it pops in. */
const SCORE_BOX_MIN_H = 104;

export function RevealCard({ outcome, animate, onAnimationDone, derived, otherNames }: Props) {
  const { t } = useTranslation();
  const lang = currentLang();
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(animate ? 0 : 1);
  const scoreScale = useSharedValue(animate ? 0 : 1);
  /** Value shown while rolling; ignored once settled (then we render the exact price). */
  const [rolling, setRolling] = useState(0);
  const [settled, setSettled] = useState(!animate);
  const settledRef = useRef(!animate);

  const roundId = outcome.round.id;
  const { price, guess, score, cell } = outcome;

  /** Land on the exact price and show the score. `celebrate` = haptic + announce + notify parent. */
  const settle = useCallback((celebrate: boolean) => {
    if (settledRef.current) return;
    settledRef.current = true;
    cancelAnimation(progress);
    progress.value = 1;
    setSettled(true);
    if (!celebrate) { scoreScale.value = 1; return; }
    scoreScale.value = withSpring(1, { damping: 12, stiffness: 220 });
    void haptic.reveal(score);
    AccessibilityInfo.announceForAccessibility(
      `${t('round.asking')} ${formatEur(price, lang)}. ${t('reveal.points', { n: score })}`,
    );
    onAnimationDone();
    // onAnimationDone/t are stable enough per round; the effect below re-keys on the round anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [price, score, lang, roundId]);

  const finish = useCallback(() => settle(true), [settle]);

  useEffect(() => {
    if (!animate) { settle(false); return; }
    // New round (or first mount) while REVEALING: restart from 0.
    settledRef.current = false;
    setSettled(false);
    setRolling(0);
    scoreScale.value = 0;
    if (reduceMotion) { settle(true); return; }
    progress.value = 0;
    progress.value = withTiming(
      1,
      { duration: REVEAL_ANIM_MS, easing: Easing.out(Easing.cubic) },
      (ok) => { if (ok) runOnJS(finish)(); },
    );
    // Cleanup runs on unmount or before the effect re-runs for a new round /
    // `animate` change; the cancelled timing's callback gets ok=false and does nothing.
    return () => { cancelAnimation(progress); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animate, roundId, reduceMotion]);

  useAnimatedReaction(
    () => progress.value,
    (p, prev) => { if (p !== prev && p < 1) runOnJS(setRolling)(Math.round(price * p)); },
    [price],
  );

  // Exact once settled; the rolling value only ever renders mid-animation.
  const shownPrice = settled ? price : rolling;

  // Live €/m² / €/ha: only for flats/houses/land with a known area. While the
  // count-up is still at 0 keep the line (at 0) so the layout does not jump.
  const cat = outcome.round.category;
  const attrs = outcome.round.attributes;
  const finalDerived = derivedValue(price, cat, attrs);
  const liveDerived = finalDerived ? (derivedValue(shownPrice, cat, attrs) ?? { ...finalDerived, value: 0 }) : null;
  const derivedText = liveDerived
    ? t(liveDerived.kind === 'per_m2' ? 'keypad.per_m2' : 'keypad.per_ha', { value: formatEur(liveDerived.value, lang) })
    : derived ?? null;

  // err = |guess − price| / price (src/game/scoring.ts relativeError), shown
  // uncapped: 180 % stays 180 %. No guess (guess ≤ 0) is exactly 100 % by definition.
  const pct = formatPercent(outcome.err, lang);
  // Colour follows gridCell thresholds (≤10 % green, ≤25 % yellow, else red).
  const tileColor = gridColor(cell);
  const perfect = guess > 0 && outcome.err === 0;
  const noGuess = guess <= 0;
  const rollingNow = animate && !settled;

  return (
    <Pressable onPress={finish} style={styles.card} accessibilityRole="summary">
      <Text style={styles.asking}>{t('round.asking')}</Text>
      <Text
        style={[styles.price, rollingNow && styles.priceRolling]}
        numberOfLines={1}
        adjustsFontSizeToFit
        accessibilityLabel={settled ? `${t('round.asking')} ${formatEur(price, lang)}` : undefined}
      >
        {formatEur(shownPrice, lang)}
      </Text>
      {derivedText ? <Text style={styles.derived}>{derivedText}</Text> : null}

      {/* Score box sits above the guess rows; space is reserved so they never shift. */}
      <View style={styles.scoreSlot}>
        <Animated.View
          style={[styles.scoreBox, { borderColor: tileColor, transform: [{ scale: scoreScale }] }]}
          accessible={settled}
          accessibilityElementsHidden={!settled}
          importantForAccessibility={settled ? 'auto' : 'no-hide-descendants'}
          accessibilityLabel={t('reveal.points', { n: score })}
        >
          <Text style={[styles.score, { color: tileColor }]}>{score}</Text>
          <Text style={styles.scoreLabel}>{t('reveal.points_label')}</Text>
          {outcome.hints.length > 0 && <Text style={styles.penalty}>{t('reveal.hint_penalty', { n: outcome.rawScore })}</Text>}
          <Text style={styles.tile}>{cell}</Text>
        </Animated.View>
      </View>

      <View style={styles.rows}>
        <View style={styles.row}>
          <Text style={styles.label}>{t('reveal.your_guess')}</Text>
          <Text style={styles.valueText}>{noGuess ? t('round.time_up') : formatEur(guess, lang)}</Text>
        </View>
        {!noGuess && (
          <View style={styles.row}>
            <Text style={styles.label}>{perfect ? t('reveal.perfect') : t('reveal.off_by_label')}</Text>
            <Text style={[styles.valueText, { color: tileColor }]}>{perfect ? '✓' : pct}</Text>
          </View>
        )}
      </View>

      {settled && !noGuess && (
        <ScoreBar price={price} guess={guess} others={outcome.others} otherNames={otherNames} />
      )}

      {settled && score < 100 && !perfect && (
        <Text style={styles.soft}>{t('reveal.soft_miss')}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.xl, alignItems: 'center', gap: spacing.sm },
  asking: { ...type.small, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 1 },
  price: { ...type.display, color: colors.text, fontVariant: ['tabular-nums'] },
  priceRolling: { color: colors.accent },
  derived: { ...type.body, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  scoreSlot: { marginTop: spacing.md, minHeight: SCORE_BOX_MIN_H, alignItems: 'center', justifyContent: 'center' },
  scoreBox: { borderWidth: 2, borderRadius: radius.lg, paddingVertical: spacing.md, paddingHorizontal: spacing.xl, alignItems: 'center', minWidth: 140 },
  score: { fontSize: 44, fontWeight: '800', fontVariant: ['tabular-nums'] },
  scoreLabel: { ...type.small, color: colors.textMuted },
  penalty: { ...type.small, color: colors.textMuted, fontSize: 11, marginTop: 2 },
  tile: { position: 'absolute', top: -12, right: -12, fontSize: 22 },
  rows: { width: '100%', marginTop: spacing.sm, gap: spacing.xs },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  label: { ...type.body, color: colors.textMuted },
  valueText: { ...type.body, color: colors.text, fontWeight: '600', fontVariant: ['tabular-nums'] },
  soft: { ...type.small, color: colors.textMuted, textAlign: 'center', marginTop: spacing.sm },
});
