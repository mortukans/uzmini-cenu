import { useEffect } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { colors, radius } from '../theme';

interface Props { width?: number | `${number}%`; height?: number; round?: number; style?: StyleProp<ViewStyle> }

/** Shimmering placeholder shaped like the content it replaces. */
export function Skeleton({ width = '100%', height = 16, round = radius.sm, style }: Props) {
  const o = useSharedValue(0.4);
  useEffect(() => { o.value = withRepeat(withTiming(1, { duration: 800 }), -1, true); }, [o]);
  const a = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[styles.base, { width, height, borderRadius: round }, a, style]} />;
}

const styles = StyleSheet.create({ base: { backgroundColor: colors.surfaceAlt } });
