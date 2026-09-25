import 'react-native-gesture-handler';
import '../src/i18n';
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { View, ActivityIndicator } from 'react-native';
import { useAuth } from '../src/auth/store';
import { usePushNotifications } from '../src/notifications/usePush';
import { useAnalyticsBootstrap } from '../src/analytics';
import { colors } from '../src/ui/theme';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

export default function RootLayout() {
  const { ready, bootstrap } = useAuth();
  useEffect(() => { void bootstrap(); }, [bootstrap]);
  usePushNotifications();
  useAnalyticsBootstrap();

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'fade' }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="onboarding" options={{ presentation: 'fullScreenModal' }} />
          <Stack.Screen name="play/[sessionId]" />
          <Stack.Screen name="daily/info" options={{ presentation: 'modal' }} />
          <Stack.Screen name="daily/result" options={{ presentation: 'modal' }} />
          <Stack.Screen name="leaderboard" options={{ presentation: 'modal' }} />
          <Stack.Screen name="sign-in" options={{ presentation: 'modal' }} />
          <Stack.Screen name="duel/[duelId]" />
          <Stack.Screen name="room/[code]" />
          <Stack.Screen name="r/[code]" />
          <Stack.Screen name="d/[number]" />
        </Stack>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
