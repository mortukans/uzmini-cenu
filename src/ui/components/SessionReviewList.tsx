/**
 * Tappable list of every listing of a finished session (session review).
 * Each row: 56×56 thumbnail, round number, title/subtitle, asking price over
 * the guess, score coloured by grid cell, and a red marker when the listing
 * is no longer available. Tapping opens `ListingReviewSheet` via `onPress`.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';

import type { Category, ListingAvailability } from '../../api/types';
import { formatEur } from '../../game/format';
import { thumbUrl } from '../../game/session';
import { currentLang } from '../../i18n';
import { isRemoved, type ReviewItem } from './ListingReviewSheet';
import { colors, gridColor, radius, spacing, type } from '../theme';

const GLYPH: Record<Category, string> = { flats: '🏢', houses: '🏠', cars: '🚗', random: '📦', land: '🌲' };

interface Props {
  items: ReviewItem[];
  availability?: Record<number, ListingAvailability | undefined>;
  onPress: (item: ReviewItem) => void;
  /** Listing id to draw with a subtle accent border (streak: the final miss). */
  highlightId?: number;
  /** Small caption shown under the highlighted row's title. */
  highlightLabel?: string;
}

export function SessionReviewList({ items, availability, onPress, highlightId, highlightLabel }: Props) {
  const { t } = useTranslation();
  const { t: tr } = useTranslation('review');
  const lang = currentLang();

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>{tr('title')}</Text>
      <Text style={styles.hint}>{tr('tap_hint')}</Text>
      {items.map((item, i) => {
        const a = availability?.[item.id];
        const removed = isRemoved(a);
        const highlighted = highlightId != null && item.id === highlightId;
        const roundNo = item.roundNo ?? i + 1;
        const thumb = item.photoUrls[0] ? thumbUrl(item.photoUrls[0]) : null;
        const label = [
          t('round.round_n', { n: roundNo }), item.title, item.subtitle,
          `${t('round.asking')} ${formatEur(item.price, lang)}`, `${t('reveal.your_guess')} ${formatEur(item.guess, lang)}`,
          t('reveal.points', { count: item.score }), removed ? tr('removed') : null,
        ].filter(Boolean).join(', ');
        return (
          <Pressable
            key={`${item.id}-${roundNo}`}
            onPress={() => onPress(item)}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityHint={tr('tap_hint')}
            style={({ pressed }) => [styles.row, highlighted && styles.rowHighlighted, pressed && styles.rowPressed]}
          >
            <View style={styles.thumbWrap}>
              {thumb ? (
                <Image source={{ uri: thumb }} contentFit="cover" cachePolicy="memory-disk" transition={150} style={styles.thumb} />
              ) : (
                <Text style={styles.glyph}>{GLYPH[item.category ?? 'random']}</Text>
              )}
              <View style={styles.roundBadge}><Text style={styles.roundText}>{roundNo}</Text></View>
            </View>

            <View style={styles.mid}>
              <View style={styles.titleRow}>
                {removed && <View style={styles.removedDot} accessible={false} />}
                <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
              </View>
              {item.subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{item.subtitle}</Text> : null}
              {removed ? (
                <Text style={styles.removedText} numberOfLines={1}>{tr('removed')}</Text>
              ) : highlighted && highlightLabel ? (
                <Text style={styles.highlightText} numberOfLines={1}>{highlightLabel}</Text>
              ) : null}
            </View>

            <View style={styles.right}>
              <Text style={styles.price}>{formatEur(item.price, lang)}</Text>
              <Text style={styles.guess}>{formatEur(item.guess, lang)}</Text>
            </View>
            <Text style={[styles.score, { color: gridColor(item.cell) }]}>{item.score}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const THUMB = 56;

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.xl, gap: 6 },
  heading: { ...type.h3, color: colors.text },
  hint: { ...type.small, color: colors.textMuted, marginBottom: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.sm, borderWidth: 1, borderColor: 'transparent' },
  rowHighlighted: { borderColor: colors.accent },
  rowPressed: { opacity: 0.8 },
  thumbWrap: { width: THUMB, height: THUMB, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  thumb: { width: THUMB, height: THUMB, backgroundColor: colors.surfaceAlt },
  glyph: { fontSize: 24 },
  roundBadge: { position: 'absolute', top: 0, left: 0, backgroundColor: colors.overlay, borderBottomRightRadius: radius.sm, paddingHorizontal: 5, paddingVertical: 1 },
  roundText: { ...type.small, color: colors.text, fontSize: 11, fontWeight: '600' },
  mid: { flex: 1, gap: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { ...type.body, color: colors.text, fontSize: 15, flexShrink: 1 },
  subtitle: { ...type.small, color: colors.textMuted },
  removedDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.red },
  removedText: { ...type.small, color: colors.red, fontSize: 12 },
  highlightText: { ...type.small, color: colors.accent, fontSize: 12 },
  right: { alignItems: 'flex-end', gap: 1 },
  price: { ...type.body, color: colors.text, fontWeight: '700', fontVariant: ['tabular-nums'], fontSize: 15 },
  guess: { ...type.small, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  score: { ...type.body, fontWeight: '700', fontVariant: ['tabular-nums'], width: 44, textAlign: 'right' },
});
