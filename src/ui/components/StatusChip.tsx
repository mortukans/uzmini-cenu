/** StatusChip — small pill with a tone. Owned by the social agent. */
import { Text, View, type ViewStyle } from 'react-native';
import { colors, radius, spacing } from '../theme';

export type ChipTone = 'neutral' | 'accent' | 'green' | 'yellow' | 'red' | 'blue';

const bg: Record<ChipTone, string> = {
  neutral: colors.surfaceAlt,
  accent: 'rgba(245,184,64,0.18)',
  green: 'rgba(61,214,140,0.18)',
  yellow: 'rgba(245,197,67,0.18)',
  red: 'rgba(240,96,96,0.18)',
  blue: 'rgba(90,169,255,0.18)',
};
const fg: Record<ChipTone, string> = {
  neutral: colors.textMuted,
  accent: colors.accent,
  green: colors.green,
  yellow: colors.yellow,
  red: colors.red,
  blue: colors.blue,
};

export function StatusChip({ label, tone = 'neutral', style }: { label: string; tone?: ChipTone; style?: ViewStyle }) {
  return (
    <View
      style={[
        {
          alignSelf: 'flex-start',
          paddingHorizontal: spacing.sm + 2,
          paddingVertical: 3,
          borderRadius: radius.pill,
          backgroundColor: bg[tone],
        },
        style,
      ]}
    >
      <Text style={{ color: fg[tone], fontSize: 12, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}
