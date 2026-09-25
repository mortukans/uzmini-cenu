/**
 * Guess-vs-price bar: your guess (●) vs the asking price (▲); duel/room add
 * other players (◆). Log scale so a 2× overshoot and a 2× undershoot are
 * symmetric on the bar.
 */
import { StyleSheet, Text, View, type DimensionValue } from 'react-native';
import { formatEurShort } from '../../game/format';
import { currentLang } from '../../i18n';
import { colors, spacing, type } from '../theme';

interface Props {
  price: number;
  guess: number;
  others?: Record<string, { guess: number; score: number }>;
  otherNames?: Record<string, string>;
}

export function ScoreBar({ price, guess, others, otherNames }: Props) {
  const lang = currentLang();
  const values = [price, guess, ...Object.values(others ?? {}).map((o) => o.guess)].filter((v) => v > 0);
  const lo = Math.min(...values) / 1.3;
  const hi = Math.max(...values) * 1.3;
  const pos = (v: number) => {
    if (v <= 0) return 0;
    const p = (Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo));
    return Math.max(0.02, Math.min(0.98, p));
  };
  const pct = (v: number): DimensionValue => `${(pos(v) * 100).toFixed(1)}%` as DimensionValue;

  return (
    <View style={styles.root} accessible accessibilityLabel={`${formatEurShort(guess, lang)} / ${formatEurShort(price, lang)}`}>
      <View style={styles.track}>
        <View style={[styles.marker, { left: pct(price) }]}><Text style={[styles.glyph, { color: colors.accent }]}>▲</Text></View>
        {guess > 0 && <View style={[styles.marker, styles.markerTop, { left: pct(guess) }]}><Text style={[styles.glyph, { color: colors.text }]}>●</Text></View>}
        {Object.entries(others ?? {}).map(([uid, o]) => o.guess > 0 && (
          <View key={uid} style={[styles.marker, styles.markerTop, { left: pct(o.guess) }]}>
            <Text style={[styles.glyph, { color: colors.blue }]}>◆</Text>
            {otherNames?.[uid] ? <Text style={styles.name} numberOfLines={1}>{otherNames[uid]}</Text> : null}
          </View>
        ))}
      </View>
      <View style={styles.axis}>
        <Text style={styles.axisText}>{formatEurShort(Math.round(lo), lang)}</Text>
        <Text style={styles.axisText}>{formatEurShort(Math.round(hi), lang)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: '100%', marginTop: spacing.lg },
  track: { height: 3, backgroundColor: colors.border, borderRadius: 2, marginVertical: 18 },
  marker: { position: 'absolute', top: -6, marginLeft: -7, alignItems: 'center' },
  markerTop: { top: -22 },
  glyph: { fontSize: 14, lineHeight: 16 },
  name: { ...type.small, color: colors.blue, fontSize: 10, maxWidth: 60 },
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
  axisText: { ...type.small, color: colors.textMuted, fontSize: 11, fontVariant: ['tabular-nums'] },
});
