/**
 * Reveal payoff (docs/11 §2.5): price count-up over 1.2 s, then the score pops
 * in with its grid colour. Tap anywhere to skip the animation. Respects
 * Reduce Motion (fade instead of count-up).
 */
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedReaction, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import type { Outcome } from '../../game/machine';
import { REVEAL_ANIM_MS } from '../../game/machine';
import { formatEur, formatPercent } from '../../game/format';
import { currentLang } from '../../i18n';
import { haptic } from '../haptics';
import { colors, gridColor, radius, spacing, type } from '../theme';
import { ScoreBar } from './ScoreBar';

interface Props {
  outcome: Outcome;
  /** REVEALING → animate; REVEALED → static. */
  animate: boolean;
  onAnimationDone: () => void;
  /** Derived €/m² etc. shown under the price. */
  derived?: string | null;
  /** Duel/room: named markers for other players. */
  otherNames?: Record<string, string>;
}

export function RevealCard({ outcome, animate, onAnimationDone, derived, otherNames }: Props) {
  const { t } = useTranslation();
  const lang = currentLang();
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(animate ? 0 : 1);
  const [shown, setShown] = useState(animate ? 0 : outcome.price);
  const [scoreVisible, setScoreVisible] = useState(!animate);
  const scoreScale = useSharedValue(animate ? 0 : 1);
  const done = useRef(!animate);

  const finish = () => {
    if (done.current) return;
    done.current = true;
    setShown(outcome.price);
    setScoreVisible(true);
    scoreScale.value = withSpring(1, { damping: 12, stiffness: 220 });
    void haptic.reveal(outcome.score);
    AccessibilityInfo.announceForAccessibility(
      `${t('round.asking')} ${formatEur(outcome.price, lang)}. ${t('reveal.points', { n: outcome.score })}`,
    );
    onAnimationDone();
  };

  useEffect(() => {
    if (!animate) return;
    if (reduceMotion) { finish(); return; }
    progress.value = withTiming(1, { duration: REVEAL_ANIM_MS, easing: Easing.out(Easing.cubic) }, (ok) => { if (ok) runOnJS(finish)(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animate]);

  useAnimatedReaction(
    () => progress.value,
    (p) => { if (!done.current) runOnJS(setShown)(Math.round(outcome.price * p)); },
    [outcome.price],
  );

  const pct = formatPercent(outcome.err, lang);
  const tileColor = gridColor(outcome.cell);
  const perfect = outcome.guess > 0 && outcome.err === 0;
  const noGuess = outcome.guess <= 0;

  return (
    <Pressable onPress={finish} style={styles.card} accessibilityRole="summary">
      <Text style={styles.asking}>{t('round.asking')}</Text>
      <Text style={[styles.price, !done.current && animate && styles.priceRolling]} numberOfLines={1} adjustsFontSizeToFit>
        {formatEur(shown, lang)}
      </Text>
      {derived ? <Text style={styles.derived}>{derived}</Text> : null}

      <View style={styles.rows}>
        <View style={styles.row}>
          <Text style={styles.label}>{t('reveal.your_guess')}</Text>
          <Text style={styles.valueText}>{noGuess ? t('round.time_up') : formatEur(outcome.guess, lang)}</Text>
        </View>
        {!noGuess && (
          <View style={styles.row}>
            <Text style={styles.label}>{perfect ? t('reveal.perfect') : t('reveal.off_by_label')}</Text>
            <Text style={[styles.valueText, { color: tileColor }]}>{perfect ? '✓' : pct}</Text>
          </View>
        )}
      </View>

      {scoreVisible && (
        <Animated.View style={[styles.scoreBox, { borderColor: tileColor, transform: [{ scale: scoreScale }] }]}>
          <Text style={[styles.score, { color: tileColor }]}>{outcome.score}</Text>
          <Text style={styles.scoreLabel}>{t('reveal.points_label')}</Text>
          {outcome.hints.length > 0 && <Text style={styles.penalty}>{t('reveal.hint_penalty', { n: outcome.rawScore })}</Text>}
          <Text style={styles.tile}>{outcome.cell}</Text>
        </Animated.View>
      )}

      {scoreVisible && !noGuess && (
        <ScoreBar price={outcome.price} guess={outcome.guess} others={outcome.others} otherNames={otherNames} />
      )}

      {scoreVisible && outcome.score < 100 && !perfect && (
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
  rows: { width: '100%', marginTop: spacing.md, gap: spacing.xs },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  label: { ...type.body, color: colors.textMuted },
  valueText: { ...type.body, color: colors.text, fontWeight: '600', fontVariant: ['tabular-nums'] },
  scoreBox: { marginTop: spacing.md, borderWidth: 2, borderRadius: radius.lg, paddingVertical: spacing.md, paddingHorizontal: spacing.xl, alignItems: 'center', minWidth: 140 },
  score: { fontSize: 44, fontWeight: '800', fontVariant: ['tabular-nums'] },
  scoreLabel: { ...type.small, color: colors.textMuted },
  penalty: { ...type.small, color: colors.textMuted, fontSize: 11, marginTop: 2 },
  tile: { position: 'absolute', top: -12, right: -12, fontSize: 22 },
  soft: { ...type.small, color: colors.textMuted, textAlign: 'center', marginTop: spacing.sm },
});
