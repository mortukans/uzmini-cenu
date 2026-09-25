import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { AppState, Platform } from 'react-native';
import { env } from '../env';

// SecureStore caps values around 2 KB; Supabase sessions are ~1 KB. If that
// ever changes, chunk or move to expo-sqlite. Web falls back to localStorage.
const secureStorage = {
  getItem: (k: string) => (Platform.OS === 'web' ? Promise.resolve(globalThis.localStorage?.getItem(k) ?? null) : SecureStore.getItemAsync(k)),
  setItem: (k: string, v: string) => (Platform.OS === 'web' ? Promise.resolve(void globalThis.localStorage?.setItem(k, v)) : SecureStore.setItemAsync(k, v)),
  removeItem: (k: string) => (Platform.OS === 'web' ? Promise.resolve(void globalThis.localStorage?.removeItem(k)) : SecureStore.deleteItemAsync(k)),
};

export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
  auth: { storage: secureStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
  realtime: { params: { eventsPerSecond: 10 } },
});

// Refresh tokens only while the app is in the foreground.
AppState.addEventListener('change', (s) => {
  if (s === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});
