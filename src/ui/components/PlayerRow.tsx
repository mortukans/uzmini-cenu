/** PlayerRow — avatar + name + optional subtitle/right slot. Owned by the social agent. */
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Avatar } from './Avatar';
import { colors, radius, spacing, type } from '../theme';

interface Props {
  username?: string | null;
  avatar?: string | null;
  subtitle?: string;
  online?: boolean;
  highlight?: boolean;
  right?: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
}

export function PlayerRow({ username, avatar, subtitle, online, highlight, right, onPress, onLongPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!onPress && !onLongPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        paddingVertical: spacing.sm + 2,
        paddingHorizontal: spacing.md,
        borderRadius: radius.md,
        backgroundColor: pressed ? colors.surfaceAlt : highlight ? 'rgba(245,184,64,0.08)' : 'transparent',
      })}
    >
      <Avatar avatar={avatar} username={username} online={online} highlight={highlight} />
      <View style={{ flex: 1 }}>
        <Text style={[type.body, { color: colors.text, fontWeight: '600' }]} numberOfLines={1}>
          {username ?? '…'}
        </Text>
        {subtitle ? (
          <Text style={[type.small, { color: colors.textMuted }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </Pressable>
  );
}
