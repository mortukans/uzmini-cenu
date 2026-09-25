/**
 * usePushNotifications — called once from app/_layout.tsx.
 * - Real device only: ask permission, get Expo push token (projectId from
 *   Constants.expoConfig.extra.eas.projectId; skips gracefully if missing),
 *   register via RPC once a session exists (every account is anonymous).
 * - Foreground handler: banner + sound for invites, silent list entry for results.
 * - Response listener + cold-start response → route by data.type (linking.ts).
 * Depends on: src/auth/store, src/api/rpc.registerPushToken, ./linking.
 */
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { registerPushToken } from '../api/rpc';
import { useAuth } from '../auth/store';
import { isConfigured } from '../env';
import { go, routeForPush } from './linking';

const LOUD_TYPES = new Set(['duel_invite', 'duel_accepted', 'room_invite', 'friend_request']);

Notifications.setNotificationHandler({
  handleNotification: async (n) => {
    const type = (n.request.content.data as { type?: string } | undefined)?.type ?? '';
    const loud = LOUD_TYPES.has(type);
    return { shouldShowBanner: loud, shouldShowList: true, shouldPlaySound: loud, shouldSetBadge: false };
  },
});

const projectId = (): string | undefined =>
  (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
  (Constants as unknown as { easConfig?: { projectId?: string } | null }).easConfig?.projectId;

/** Idempotent; safe to call from a "remind me" toggle too. Returns the token or null. */
export async function registerPushIfPossible(): Promise<string | null> {
  if (!Device.isDevice || Platform.OS === 'web' || !isConfigured) return null;
  const pid = projectId();
  if (!pid) {
    if (__DEV__) console.warn('[push] no EAS projectId in app config; skipping registration');
    return null;
  }
  try {
    const perm = await Notifications.getPermissionsAsync();
    const status = perm.status === 'granted' ? perm.status : (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return null;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: pid });
    await registerPushToken(token, Platform.OS === 'android' ? 'android' : 'ios');
    return token;
  } catch (e) {
    if (__DEV__) console.warn('[push] registration failed', e);
    return null;
  }
}

export function usePushNotifications() {
  const ready = useAuth((s) => s.ready);
  const uid = useAuth((s) => s.session?.user.id ?? null);
  const registeredFor = useRef<string | null>(null);
  const handledCold = useRef(false);

  // Register once per user id.
  useEffect(() => {
    if (!ready || !uid || registeredFor.current === uid) return;
    registeredFor.current = uid;
    void registerPushIfPossible();
  }, [ready, uid]);

  // Route on tap: warm/background via listener, cold start via last response.
  useEffect(() => {
    if (!ready) return;
    const route = (resp: Notifications.NotificationResponse | null) => {
      const path = routeForPush(resp?.notification.request.content.data);
      if (path) go(path);
    };
    const sub = Notifications.addNotificationResponseReceivedListener(route);
    if (!handledCold.current) {
      handledCold.current = true;
      Notifications.getLastNotificationResponseAsync().then(route).catch(() => undefined);
    }
    return () => sub.remove();
  }, [ready]);
}
