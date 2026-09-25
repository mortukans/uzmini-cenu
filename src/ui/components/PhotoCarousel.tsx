/**
 * Swipeable photo carousel (docs/02 §1, §8). expo-image with progressive load:
 * the `.t.jpg` thumbnail shows as placeholder while the `.800.jpg` loads.
 * Photo failures fall through to the next photo, then to a category glyph.
 */
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import type { Category } from '../../api/types';
import { thumbUrl } from '../../game/session';
import { track } from '../../analytics';
import { colors, radius, spacing, type } from '../theme';

const GLYPH: Record<Category, string> = { flats: '🏢', houses: '🏠', cars: '🚗', random: '📦', land: '🌲' };
const PHOTO_TIMEOUT_MS = 2000;

interface Props {
  urls: string[];
  category: Category;
  source: string;
  listingId: number;
  /** Photos beyond this index are hidden until the "extra photo" hint. */
  visibleCount?: number;
  height?: number;
  onTap?: () => void;
}

export function PhotoCarousel({ urls, category, source, listingId, visibleCount, height = 260, onTap }: Props) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const w = width - spacing.lg * 2;
  const photos = urls.slice(0, visibleCount ?? urls.length);
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState<Set<number>>(new Set());
  const tx = useSharedValue(0);

  useEffect(() => { setIndex(0); setFailed(new Set()); tx.value = 0; }, [listingId, tx]);

  const goTo = useCallback((i: number) => {
    const clamped = Math.max(0, Math.min(photos.length - 1, i));
    setIndex(clamped);
    tx.value = withSpring(-clamped * w, { damping: 20, stiffness: 180 });
    if (clamped !== index) track('round_photo_swipe', { index: clamped });
  }, [photos.length, w, index, tx]);

  const pan = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .failOffsetY([-16, 16])
    .onUpdate((e) => { tx.value = -index * w + e.translationX; })
    .onEnd((e) => {
      const dir = e.translationX < -w / 5 || e.velocityX < -500 ? 1 : e.translationX > w / 5 || e.velocityX > 500 ? -1 : 0;
      runOnJS(goTo)(index + dir);
    });

  const strip = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));

  const onFail = (i: number) => {
    track('photo_failed', { listing_id: listingId, index: i });
    setFailed((prev) => new Set(prev).add(i));
    if (i === index && i + 1 < photos.length) goTo(i + 1);
  };

  // 2 s timeout for the current photo → move on.
  const [loaded, setLoaded] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (loaded.has(index) || failed.has(index)) return;
    const id = setTimeout(() => { if (!loaded.has(index)) onFail(index); }, PHOTO_TIMEOUT_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, loaded, failed]);

  const allFailed = photos.length === 0 || photos.every((_, i) => failed.has(i));

  return (
    <View style={[styles.frame, { height, width: w }]} accessible accessibilityLabel={t('photo.a11y', { n: index + 1, total: photos.length })}>
      {allFailed ? (
        <View style={styles.placeholder}><Text style={styles.glyph}>{GLYPH[category]}</Text></View>
      ) : (
        <GestureDetector gesture={pan}>
          <Animated.View style={[styles.strip, { width: w * photos.length }, strip]}>
            {photos.map((u, i) => (
              <Pressable key={u} onPress={onTap} style={{ width: w, height }}>
                {failed.has(i) ? (
                  <View style={styles.placeholder}><Text style={styles.glyph}>{GLYPH[category]}</Text></View>
                ) : (
                  <Image
                    source={{ uri: u }}
                    placeholder={{ uri: thumbUrl(u) }}
                    placeholderContentFit="cover"
                    contentFit="cover"
                    transition={200}
                    cachePolicy="memory-disk"
                    style={styles.img}
                    onLoad={() => setLoaded((p) => new Set(p).add(i))}
                    onError={() => onFail(i)}
                  />
                )}
              </Pressable>
            ))}
          </Animated.View>
        </GestureDetector>
      )}
      {photos.length > 1 && (
        <View style={styles.dots} pointerEvents="none">
          {photos.map((_, i) => <View key={i} style={[styles.dot, i === index && styles.dotActive]} />)}
        </View>
      )}
      {urls.length > photos.length && (
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
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceAlt },
  glyph: { fontSize: 64 },
  dots: { position: 'absolute', bottom: spacing.md, left: spacing.md, flexDirection: 'row', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.4)' },
  dotActive: { backgroundColor: colors.text },
  sourceTag: { position: 'absolute', bottom: spacing.sm, right: spacing.md, backgroundColor: colors.overlay, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  sourceText: { ...type.small, color: colors.text, fontSize: 11 },
  lockBadge: { position: 'absolute', top: spacing.sm, right: spacing.md, backgroundColor: colors.overlay, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  lockText: { ...type.small, color: colors.textMuted, fontSize: 11 },
});
