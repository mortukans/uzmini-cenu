/**
 * /r/CODE — universal-link entry (https://uzminicenu.lv/r/KTRP, uzminicenu://r/KTRP).
 * Username gate → joinRoom(code) → replace with /room/CODE. Errors show inline with a home button.
 * Depends on: src/auth/{apple,store}, src/api/rpc.joinRoom, i18n social.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { joinRoom, RpcError } from '../../src/api/rpc';
import { useRequireSignIn } from '../../src/auth/apple';
import { useAuth } from '../../src/auth/store';
import { go } from '../../src/notifications/linking';
import { colors, radius, spacing, type } from '../../src/ui/theme';

export default function RoomLinkScreen() {
  const { t } = useTranslation('social');
  const { code: raw } = useLocalSearchParams<{ code: string }>();
  const code = (raw ?? '').toUpperCase();
  const ready = useAuth((s) => s.ready);
  const requireSignIn = useRequireSignIn();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !code) return;
    let cancelled = false;
    (async () => {
      if (!(await requireSignIn())) {
        if (!cancelled) router.replace('/');
        return;
      }
      try {
        await joinRoom(code);
        if (!cancelled) go(`/room/${code}`, true);
      } catch (e) {
        const c = e instanceof RpcError ? e.code : 'unknown';
        // Already a member (e.g. reopening the link) → just open the room.
        if (c === 'room_already_started' || c === 'room_full' || c === 'room_not_found') {
          if (!cancelled) setError(t(`room.err.${c}`));
        } else if (!cancelled) go(`/room/${code}`, true);
      }
    })();
    return () => { cancelled = true; };
  }, [ready, code, requireSignIn, t]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.lg }}>
      {error ? (
        <>
          <Text style={[type.h2, { color: colors.text, textAlign: 'center' }]}>{error}</Text>
          <Pressable onPress={() => router.replace('/')} style={{ paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.pill, backgroundColor: colors.accent }}>
            <Text style={{ color: colors.accentText, fontWeight: '700' }}>{t('home')}</Text>
          </Pressable>
        </>
      ) : (
        <>
          <ActivityIndicator color={colors.accent} />
          <Text style={{ color: colors.textMuted }}>{t('room.joining', { code })}</Text>
        </>
      )}
    </View>
  );
}
