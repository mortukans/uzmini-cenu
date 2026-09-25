import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius, spacing, type } from '../theme';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface Props {
  title: string;
  onPress?: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export function Button({ title, onPress, variant = 'primary', disabled, loading, small, style, accessibilityLabel }: Props) {
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: off }}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [
        styles.base, styles[variant], small && styles.small, off && styles.disabled, pressed && !off && styles.pressed, style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.accentText : colors.text} />
      ) : (
        <Text style={[styles.label, small && styles.labelSmall, variant === 'primary' ? styles.labelPrimary : styles.labelOther, variant === 'danger' && styles.labelDanger]}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 56, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: spacing.xl, flexDirection: 'row',
  },
  small: { minHeight: 44, paddingHorizontal: spacing.lg, borderRadius: radius.md },
  primary: { backgroundColor: colors.accent },
  secondary: { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  ghost: { backgroundColor: 'transparent' },
  danger: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.red },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.8, transform: [{ scale: 0.99 }] },
  label: { ...type.h3, textAlign: 'center' },
  labelSmall: { fontSize: 15 },
  labelPrimary: { color: colors.accentText },
  labelOther: { color: colors.text },
  labelDanger: { color: colors.red },
});
