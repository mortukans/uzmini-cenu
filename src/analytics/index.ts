/**
 * PostHog analytics (docs/11 §4). Autocapture is off; every event is explicit.
 * No-op when EXPO_PUBLIC_POSTHOG_KEY is empty so the dev client runs clean.
 */
import { useEffect } from 'react';
import Constants from 'expo-constants';
import { env } from '../env';
import { useAuth } from '../auth/store';
import { currentLang } from '../i18n';

type Props = Record<string, unknown>;

interface Client {
  capture(event: string, props?: Props): void;
  screen(name: string, props?: Props): void;
  identify(id: string, props?: Props): void;
  reset(): void;
}

let client: Client | null = null;
let commonProps: Props = {};
const queue: Array<[string, Props | undefined]> = [];
const appSessionId = Math.random().toString(36).slice(2, 10);

/** Called once from the root layout. */
export function useAnalyticsBootstrap() {
  const { session, isAnonymous, hasUsername } = useAuth();

  useEffect(() => {
    if (client || !env.POSTHOG_KEY) return;
    try {
      // Lazy require so the module is not evaluated when analytics is off.
      const { PostHog } = require('posthog-react-native') as { PostHog: new (k: string, o?: Props) => Client };
      client = new PostHog(env.POSTHOG_KEY, { host: env.POSTHOG_HOST, captureAppLifecycleEvents: false, disabled: false });
      for (const [e, p] of queue) client.capture(e, p);
      queue.length = 0;
    } catch {
      client = null;
    }
  }, []);

  useEffect(() => {
    commonProps = {
      lang: currentLang(),
      is_anon: isAnonymous,
      has_username: hasUsername,
      app_version: Constants.expoConfig?.version ?? 'dev',
      session_id: appSessionId,
    };
    if (client && session?.user?.id) client.identify(session.user.id, { is_anon: isAnonymous, has_username: hasUsername });
  }, [session?.user?.id, isAnonymous, hasUsername]);
}

/** Event names are snake_case per docs/11; properties are merged with the common set. */
export function track(event: string, props?: Props) {
  const merged = { ...commonProps, ...props };
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log('[track]', event, props ?? '');
  }
  if (!env.POSTHOG_KEY) return;
  if (client) client.capture(event, merged);
  else queue.push([event, merged]);
}

export function screenView(screen: string) {
  track('screen_view', { screen });
}

export function analyticsReset() {
  client?.reset();
}
