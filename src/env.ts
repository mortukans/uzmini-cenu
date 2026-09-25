import { z } from 'zod';

/**
 * Public runtime config. EXPO_PUBLIC_* vars are inlined at build time.
 * Copy .env.example to .env and fill in your Supabase project values.
 */
const schema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(20),
  POSTHOG_KEY: z.string().optional(),
  POSTHOG_HOST: z.string().url().default('https://eu.i.posthog.com'),
  SENTRY_DSN: z.string().optional(),
  ADMOB_INTERSTITIAL_ID: z.string().optional(),
  ADMOB_REWARDED_ID: z.string().optional(),
  ADS_ENABLED: z.coerce.boolean().default(false),
  UNIVERSAL_LINK_HOST: z.string().default('uzminicenu.lv'),
});

const parsed = schema.safeParse({
  SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co',
  SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder-anon-key-placeholder',
  POSTHOG_KEY: process.env.EXPO_PUBLIC_POSTHOG_KEY || undefined,
  POSTHOG_HOST: process.env.EXPO_PUBLIC_POSTHOG_HOST || undefined,
  SENTRY_DSN: process.env.EXPO_PUBLIC_SENTRY_DSN || undefined,
  ADMOB_INTERSTITIAL_ID: process.env.EXPO_PUBLIC_ADMOB_INTERSTITIAL_ID || undefined,
  ADMOB_REWARDED_ID: process.env.EXPO_PUBLIC_ADMOB_REWARDED_ID || undefined,
  ADS_ENABLED: process.env.EXPO_PUBLIC_ADS_ENABLED === 'true',
  UNIVERSAL_LINK_HOST: process.env.EXPO_PUBLIC_UNIVERSAL_LINK_HOST || undefined,
});

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid EXPO_PUBLIC_* configuration', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment configuration');
}

export const env = parsed.data;
export const isConfigured = !env.SUPABASE_URL.includes('placeholder');
