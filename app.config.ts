import type { ConfigContext, ExpoConfig } from 'expo/config';

const BUNDLE_ID = 'lv.uzminicenu.app';
const LINK_HOST = process.env.EXPO_PUBLIC_UNIVERSAL_LINK_HOST ?? 'uzminicenu.lv';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Uzmini Cenu',
  slug: 'uzmini-cenu',
  scheme: 'uzminicenu',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'dark',
  ios: {
    bundleIdentifier: BUNDLE_ID,
    supportsTablet: false,
    associatedDomains: [`applinks:${LINK_HOST}`],
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      UIBackgroundModes: ['remote-notification'],
      CFBundleAllowMixedLocalizations: true,
      CFBundleLocalizations: ['lv', 'ru', 'en'],
    },
    entitlements: { 'aps-environment': 'production' },
  },
  android: {
    package: BUNDLE_ID,
    adaptiveIcon: {
      backgroundColor: '#0F1115',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [{ scheme: 'https', host: LINK_HOST, pathPrefix: '/r' }, { scheme: 'https', host: LINK_HOST, pathPrefix: '/d' }],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },
  web: { favicon: './assets/favicon.png', bundler: 'metro' },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-localization',
    ['expo-splash-screen', { backgroundColor: '#0F1115', image: './assets/splash-icon.png', imageWidth: 180 }],
    ['expo-notifications', { color: '#F5B840' }],
    ...(process.env.EXPO_PUBLIC_SENTRY_DSN
      ? [['@sentry/react-native/expo', { organization: process.env.SENTRY_ORG, project: process.env.SENTRY_PROJECT }] as [string, object]]
      : []),
  ],
  experiments: { typedRoutes: true },
  extra: { eas: { projectId: process.env.EAS_PROJECT_ID ?? 'c5390816-5979-4f90-81b8-d15b5e63f401' } },
  updates: { url: `https://u.expo.dev/${process.env.EAS_PROJECT_ID ?? 'c5390816-5979-4f90-81b8-d15b5e63f401'}` },
  runtimeVersion: { policy: 'appVersion' },
});
