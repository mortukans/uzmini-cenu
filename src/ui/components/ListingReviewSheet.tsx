/**
 * Session review bottom sheet: one listing the player guessed on, with the
 * asking price vs. their guess, the score, whether the ad is still listed on
 * the source portal (`get_listing_status`), and an "Open listing" button that
 * always goes to the original `sourceUrl`.
 *
 * Styled like the hint sheet in app/play/[sessionId].tsx. Used by
 * src/ui/screens/SessionSummary.tsx (solo / streak) and app/daily/result.tsx.
 */
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useTranslation } from 'react-i18next';
import * as WebBrowser from 'expo-web-browser';

import type { Category, ListingAttributes, ListingAvailability } from '../../api/types';
import { formatEur } from '../../game/format';
import { relativeDay } from '../../game/relativeTime';
import { currentLang } from '../../i18n';
import { track } from '../../analytics';
import { AttributeChips } from './AttributeChips';
import { Button } from './Button';
import { PhotoCarousel } from './PhotoCarousel';
import { colors, gridColor, radius, spacing, type } from '../theme';

/** One reviewable listing. Built from `Outcome` (session) or `StoredOutcome` (daily). */
export interface ReviewItem {
  id: number;
  /** Missing for daily results restored from local storage (`StoredOutcome` has no category). */
  category?: Category;
  title: string;
  subtitle?: string | null;
  photoUrls: string[];
  attributes?: ListingAttributes;
  guess: number;
  price: number;
  score: number;
  cell: string;
  sourceUrl: string;
  /** Source portal label (`Round.source`); derived from `sourceUrl` when missing. */
  source?: string;
  roundNo?: number;
}

export const isRemoved = (a?: ListingAvailability): boolean => a?.status === 'expired' || a?.status === 'rejected';

/** `www.ss.com/...` → `ss.com`; RN's URL lacks `hostname`, so a regex it is. */
export const sourceLabel = (item: Pick<ReviewItem, 'source' | 'sourceUrl'>): string =>
  item.source ?? item.sourceUrl.match(/^https?:\/\/(?:www\.)?([^/?#]+)/i)?.[1] ?? '';

/** Relative miss as an integer percentage (`|guess − price| / price`). */
export const offByPct = (guess: number, price: number): number => (price > 0 ? Math.round((Math.abs(guess - price) / price) * 100) : 0);

interface Props {
  item: ReviewItem | null;
  availability?: ListingAvailability;
  onClose: () => void;
}

export function ListingReviewSheet({ item, availability, onClose }: Props) {
  const { t } = useTranslation();
  const { t: tr } = useTranslation('review');
  const lang = currentLang();
  const removed = isRemoved(availability);
  const pct = item ? offByPct(item.guess, item.price) : 0;

  const openListing = () => {
    if (!item) return;
    const url = item.sourceUrl;
    track('review_open_listing', { listing_id: item.id, status: availability?.status ?? 'unknown' });
    WebBrowser.openBrowserAsync(url).catch(() => Linking.openURL(url));
  };

  const availabilityLine = (() => {
    if (availability?.status === 'active') {
      const when = availability.checked_at ? relativeDay(availability.checked_at, tr) : '';
      return { text: when ? `${tr('still_listed')} · ${tr('checked', { when })}` : tr('still_listed'), color: colors.green };
    }
    if (removed) return { text: tr('removed'), color: colors.red };
    return { text: tr('unknown'), color: colors.textMuted };
  })();

  return (
    <Modal visible={item != null} transparent animationType="slide" onRequestClose={onClose}>
      <GestureHandlerRootView style={styles.fill}>
        {/* Backdrop tap closes; the sheet is a sibling of the tappable area, so nothing inside it is a nested button. */}
        <View style={styles.sheetBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('common.close')} />
          <View style={styles.sheet}>
            {item && (
              <ScrollView bounces={false} showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
                <View style={styles.handle} />
                <PhotoCarousel
                  urls={item.photoUrls}
                  category={item.category ?? 'random'}
                  source={sourceLabel(item)}
                  listingId={item.id}
                  height={200}
                />

                <View style={styles.headerRow}>
                  <View style={styles.headerText}>
                    <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
                    {item.subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{item.subtitle}</Text> : null}
                  </View>
                  <View style={[styles.scoreBadge, { borderColor: gridColor(item.cell) }]}>
                    <Text style={[styles.scoreText, { color: gridColor(item.cell) }]}>{item.score}</Text>
                    <Text style={styles.scoreLabel}>{t('reveal.points_label')}</Text>
                  </View>
                </View>

                {item.category && item.attributes && (
                  <AttributeChips listing={{ category: item.category, attributes: item.attributes, location: null }} reveal compact />
                )}

                <View style={styles.prices}>
                  <View style={styles.priceCol}>
                    <Text style={styles.priceLabel}>{t('round.asking')}</Text>
                    <Text style={styles.priceValue}>{formatEur(item.price, lang)}</Text>
                  </View>
                  <View style={styles.priceCol}>
                    <Text style={styles.priceLabel}>{t('reveal.your_guess')}</Text>
                    <Text style={[styles.priceValue, styles.guessValue]}>{formatEur(item.guess, lang)}</Text>
                    <Text style={[styles.offBy, { color: gridColor(item.cell) }]}>{pct === 0 ? t('reveal.perfect') : t('reveal.off_by', { pct })}</Text>
                  </View>
                </View>

                <View style={styles.availability} accessibilityLiveRegion="polite">
                  <View style={[styles.dot, { backgroundColor: availabilityLine.color }]} />
                  <Text style={[styles.availabilityText, { color: availabilityLine.color }]}>{availabilityLine.text}</Text>
                </View>

                <Button
                  title={removed ? tr('open_removed') : t('reveal.open_listing')}
                  variant={removed ? 'secondary' : 'primary'}
                  onPress={openListing}
                  style={{ marginTop: spacing.lg }}
                />
                <Button title={t('common.close')} variant="ghost" onPress={onClose} style={{ marginTop: spacing.sm }} />
              </ScrollView>
            )}
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  sheetBackdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  // Horizontal padding matches PhotoCarousel's own `width − spacing.lg × 2` frame.
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xxl, maxHeight: '92%' },
  content: { gap: spacing.md },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: spacing.xs },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  headerText: { flex: 1, gap: 2 },
  title: { ...type.h3, color: colors.text },
  subtitle: { ...type.small, color: colors.textMuted },
  scoreBadge: { alignItems: 'center', borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, minWidth: 64 },
  scoreText: { ...type.h2, fontVariant: ['tabular-nums'] },
  scoreLabel: { ...type.small, color: colors.textMuted, fontSize: 11 },
  prices: { flexDirection: 'row', gap: spacing.md, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.md },
  priceCol: { flex: 1, gap: 2 },
  priceLabel: { ...type.small, color: colors.textMuted },
  priceValue: { ...type.h2, color: colors.text, fontVariant: ['tabular-nums'] },
  guessValue: { color: colors.textMuted },
  offBy: { ...type.small, fontWeight: '600' },
  availability: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  availabilityText: { ...type.small },
});
