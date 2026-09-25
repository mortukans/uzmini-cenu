/**
 * /d/37 — daily deep link (https://uzminicenu.lv/d/37). The daily is always
 * "today's" set, so the number is informational: redirect to the daily tab.
 */
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { router } from 'expo-router';
import { colors } from '../../src/ui/theme';

export default function DailyLinkScreen() {
  useEffect(() => {
    router.replace('/(tabs)/daily');
  }, []);
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}
