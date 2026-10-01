/**
 * Swipeable photo carousel (docs/02 §1, §8). expo-image with progressive load:
 * the `.t.jpg` thumbnail shows as placeholder while the `.800.jpg` loads.
 * Photo failures fall through to the next photo, then to a category glyph.
 *
 * A "failure" is an onError, a 2 s timeout, or an onLoad whose decoded source
 * is tiny: when SS.com removes an ad's photos, i.ss.com still answers 200 with
 * a 1×1 GIF for every URL, which expo-image happily renders as a blank box.
 * When every photo of a round is dead the carousel reports `onAllPhotosFailed`
 * once; the session store decides whether to discard the round (solo/streak)
 * or keep it with the placeholder card (fixed sets: daily/duel/room).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image, type ImageLoadEventData } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import type { Category } from '../../api/types';
import { thumbUrl } from '../../game/session';
import { track } from '../../analytics';
import { colors, radius, spacing, type } from '../theme';

const GLYPH: Record<Category, string> = { flats: '🏢', houses: '🏠', cars: '🚗', random: '📦', land: '🌲' };
const PHOTO_TIMEOUT_MS = 2000;
/** After the first photo failed, this long without any other photo loading = the round has no photos. */
const ALL_FAILED_GRACE_MS = 2000;
/** Decoded sources narrower than this are the CDN's "photo removed" 1×1 GIF, not a listing photo. */
export const MIN_PHOTO_PX = 50;
/** Page snap duration; a plain ease-out so the last/first photo never rubber-bands. */
const SNAP_MS = 220;

/** Pure: does an expo-image load event describe a real photo (vs. the 1×1 tombstone)? */
export function isTinyPhoto(e: Pick<ImageLoadEventData, 'source'> | undefined): boolean {
  const w = e?.source?.width;
  const h = e?.source?.height;
  // Unknown dimensions (older native builds) are trusted: never hide a photo on a guess.
  if (typeof w !== 'number' || typeof h !== 'number' || w <= 0 || h <= 0) return false;
  return w < MIN_PHOTO_PX || h < MIN_PHOTO_PX;
}

interface Props {
  urls: string[];
  category: Category;
  source: string;
  listingId: number;
  /** Photos beyond this index are hidden until the "extra photo" hint. */
  visibleCount?: number;
  height?: number;
  onTap?: () => void;
  /** Every visible photo of this listing is dead (called once per listing). */
  onAllPhotosFailed?: () => void;
}

export function PhotoCarousel({ urls, category, source, listingId, visibleCount, height = 260, onTap, onAllPhotosFailed }: Props) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const w = width - spacing.lg * 2;
  const photos = urls.slice(0, visibleCount ?? urls.length);
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState<Set<number>>(new Set());
  const [loaded, setLoaded] = useState<Set<number>>(new Set());
  const tx = useSharedValue(0);
  /** Listing id `onAllPhotosFailed` was already reported for. */
  const reportedFor = useRef<number | null>(null);

  useEffect(() => { setIndex(0); setFailed(new Set()); setLoaded(new Set()); tx.value = 0; }, [listingId, tx]);

  const goTo = useCallback((i: number) => {
    const clamped = Math.max(0, Math.min(photos.length - 1, i));
    setIndex(clamped);
    // Crisp paging snap: no spring / overshoot (looked like a rubber-band).
    tx.value = withTiming(-clamped * w, { duration: SNAP_MS, easing: Easing.out(Easing.cubic) });
    if (clamped !== index) track('round_photo_swipe', { index: clamped });
  }, [photos.length, w, index, tx]);

  // The strip may only travel between the first and the last page: no
  // overscroll / bounce beyond either end (pagingEnabled-like behaviour).
  const minX = -(photos.length - 1) * w;
  const pan = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .failOffsetY([-16, 16])
    .onUpdate((e) => { tx.value = Math.max(minX, Math.min(0, -index * w + e.translationX)); })
    .onEnd((e) => {
      const dir = e.translationX < -w / 5 || e.velocityX < -500 ? 1 : e.translationX > w / 5 || e.velocityX > 500 ? -1 : 0;
      runOnJS(goTo)(index + dir);
    });

  const strip = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));

  const onFail = (i: number, reason: 'error' | 'timeout' | 'tiny' = 'error') => {
    track('photo_failed', { listing_id: listingId, index: i, reason });
    setFailed((prev) => (prev.has(i) ? prev : new Set(prev).add(i)));
    if (i === index && i + 1 < photos.length) goTo(i + 1);
  };

  const onLoad = (i: number, e: ImageLoadEventData) => {
    if (isTinyPhoto(e)) { onFail(i, 'tiny'); return; }
    setLoaded((p) => (p.has(i) ? p : new Set(p).add(i)));
  };

  // 2 s timeout for the current photo → move on.
  useEffect(() => {
    if (loaded.has(index) || failed.has(index)) return;
    const id = setTimeout(() => { if (!loaded.has(index)) onFail(index, 'timeout'); }, PHOTO_TIMEOUT_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, loaded, failed]);

  const allFailed = photos.length > 0 && photos.every((_, i) => failed.has(i));

  // Report a photo-less round once: immediately when every photo failed, or
  // ALL_FAILED_GRACE_MS after the first photo failed while nothing else loaded
  // (the strip loads all pages in parallel, so a dead CDN entry shows up fast).
  useEffect(() => {
    if (!onAllPhotosFailed || reportedFor.current === listingId) return;
    const report = () => { reportedFor.current = listingId; onAllPhotosFailed(); };
    if (allFailed) { report(); return; }
    if (!failed.has(0) || loaded.size > 0) return;
    const id = setTimeout(report, ALL_FAILED_GRACE_MS);
    return () => clearTimeout(id);
  }, [allFailed, failed, loaded, listingId, onAllPhotosFailed]);

  const placeholder = (withText: boolean) => (
    <View style={styles.placeholder}>
      <Text style={styles.glyph}>{GLYPH[category]}</Text>
      {withText ? <Text style={styles.placeholderText}>{t('round.photo_unavailable')}</Text> : null}
    </View>
  );

  return (
    <View style={[styles.frame, { height, width: w }]} accessible accessibilityLabel={allFailed ? t('round.photo_unavailable') : t('photo.a11y', { n: index + 1, total: photos.length })}>
      {allFailed || photos.length === 0 ? (
        placeholder(true)
      ) : (
        <GestureDetector gesture={pan}>
          <Animated.View style={[styles.strip, { width: w * photos.length }, strip]}>
            {photos.map((u, i) => (
              <Pressable key={u} onPress={onTap} style={{ width: w, height }}>
                {failed.has(i) ? (
                  placeholder(false)
                ) : (
                  <Image
                    source={{ uri: u }}
                    placeholder={{ uri: thumbUrl(u) }}
                    placeholderContentFit="cover"
                    contentFit="cover"
                    transition={200}
                    cachePolicy="memory-disk"
                    style={styles.img}
                    onLoad={(e) => onLoad(i, e)}
                    onError={() => onFail(i, 'error')}
                  />
                )}
              </Pressable>
            ))}
          </Animated.View>
        </GestureDetector>
      )}
      {photos.length > 1 && !allFailed && (
        <View style={styles.dots} pointerEvents="none">
          {photos.map((_, i) => <View key={i} style={[styles.dot, i === index && styles.dotActive]} />)}
        </View>
      )}
      {urls.length > photos.length && !allFailed && (
        <View style={styles.lockBadge} pointerEvents="none"><Text style={styles.lockText}>+{urls.length - photos.length}</Text></View>
      )}
      <View style={styles.sourceTag} pointerEvents="none"><Text style={styles.sourceText}>{source}</Text></View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surface, alignSelf: 'center' },
  strip: { flexDirection: 'row', height: '100%' },
  img: { width: '100%', height: '100%', backgroundColor: colors.surfaceAlt },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceAlt, gap: spacing.sm },
  placeholderText: { ...type.small, color: colors.textMuted },
  glyph: { fontSize: 64 },
  dots: { position: 'absolute', bottom: spacing.md, left: spacing.md, flexDirection: 'row', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.4)' },
  dotActive: { backgroundColor: colors.text },
  sourceTag: { position: 'absolute', bottom: spacing.sm, right: spacing.md, backgroundColor: colors.overlay, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  sourceText: { ...type.small, color: colors.text, fontSize: 11 },
  lockBadge: { position: 'absolute', top: spacing.sm, right: spacing.md, backgroundColor: colors.overlay, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  lockText: { ...type.small, color: colors.textMuted, fontSize: 11 },
});
