/**
 * Avatar — preset-icon avatar (no uploads in v1). `avatar` is either an emoji /
 * short glyph stored in profiles.avatar or null → initials from username.
 * Owned by the social agent; no dependencies beyond theme.
 */
import { Text, View, type ViewStyle } from 'react-native';
import { colors, radius } from '../theme';

interface Props {
  avatar?: string | null;
  username?: string | null;
  size?: number;
  online?: boolean;
  highlight?: boolean;
  style?: ViewStyle;
}

export function Avatar({ avatar, username, size = 40, online, highlight, style }: Props) {
  const initials = (username ?? '?').trim().slice(0, 2).toUpperCase();
  const glyph = avatar && avatar.length <= 4 ? avatar : initials;
  return (
    <View style={[{ width: size, height: size }, style]}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: radius.pill,
          backgroundColor: colors.surfaceAlt,
          borderWidth: highlight ? 2 : 1,
          borderColor: highlight ? colors.accent : colors.border,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: colors.text, fontSize: size * 0.42, fontWeight: '700' }}>{glyph}</Text>
      </View>
      {online !== undefined && (
        <View
          style={{
            position: 'absolute',
            right: -1,
            bottom: -1,
            width: size * 0.3,
            height: size * 0.3,
            borderRadius: radius.pill,
            backgroundColor: online ? colors.green : colors.textMuted,
            borderWidth: 2,
            borderColor: colors.bg,
          }}
        />
      )}
    </View>
  );
}
