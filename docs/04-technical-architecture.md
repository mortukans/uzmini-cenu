# 04 Technical architecture

## Constraints

- Dev on Windows, no Mac. iOS builds and TestFlight submission via **EAS
  Build / EAS Submit** in the cloud. Same decision as the AI Recap project.
- Solo developer. Prefer managed services and zero ops.
- Latvia / EU: Supabase project in EU region (Frankfurt).

## Stack

| Layer | Choice | Why |
|-------|--------|-----|
| App | Expo SDK (latest), React Native, TypeScript, Expo Router | already known from AI Recap, EAS handles iOS |
| State | Zustand + TanStack Query | simple, offline-friendly caching |
| UI | plain RN + Reanimated (Tamagui optional) | reveal animations matter |
| Images | expo-image with disk cache | progressive loading, prefetch next round |
| Backend | Supabase: Postgres, Auth, Realtime, Edge Functions | one bill, EU region, Realtime covers multiplayer |
| Auth | Sign in with Apple + anonymous sessions | App Store requirement, low friction |
| Push | Expo Push Notifications (APNs under the hood) | invites, "daily challenge is ready", duel results |
| Scraper | Node/TypeScript job (Edge Function cron; move to Fly.io if runtime limits) | shares types with app |
| Ads | Google AdMob via react-native-google-mobile-ads | interstitial every 5 rounds, rewarded ad for hints; needs a custom dev client |
| IAP | RevenueCat | premium "no ads + unlimited duels" |
| Analytics | PostHog (EU cloud) | funnels, retention |
| Crash | Sentry | |
| CI | EAS Build on git tag, EAS Update for OTA JS fixes | |

## Package list

Versions are the Expo SDK 54 era (autumn 2025). Treat every number as
"verify at setup": run `npx expo install <pkg>` and let Expo pin the
compatible version. Anything not managed by `expo install` is marked (npm).

### Runtime

| Package | Version | Purpose |
|---------|---------|---------|
| `expo` | ~54.0 | SDK |
| `react-native` | 0.81.x | pinned by SDK |
| `react` | 19.1.x | pinned by SDK |
| `expo-router` | ~6.0 | file-based routing, deep links |
| `expo-image` | ~3.0 | photo carousel, disk cache, prefetch |
| `expo-notifications` | ~0.32 | push token, handlers |
| `expo-device` | ~8.0 | skip push registration on simulator |
| `expo-localization` | ~17.0 | device locale for i18n |
| `expo-secure-store` | ~15.0 | Supabase session persistence |
| `expo-apple-authentication` | ~8.0 | Sign in with Apple |
| `expo-haptics` | ~15.0 | reveal feedback |
| `expo-linking` | ~8.0 | universal links |
| `expo-constants` | ~18.0 | read `extra` / EAS project id |
| `expo-updates` | ~29.0 | OTA hotfixes |
| `expo-dev-client` | ~6.0 | custom dev client |
| `expo-splash-screen`, `expo-status-bar`, `expo-font` | SDK-pinned | boilerplate |
| `react-native-reanimated` | ~4.1 | count-up reveal, transitions |
| `react-native-gesture-handler` | ~2.28 | carousel swipes |
| `react-native-safe-area-context`, `react-native-screens` | SDK-pinned | required by router |
| `@supabase/supabase-js` | ^2.5x (npm) | client, RPC, Realtime |
| `@tanstack/react-query` | ^5 (npm) | server state, prefetch |
| `zustand` | ^5 (npm) | round state machine, UI state |
| `i18next` + `react-i18next` | ^25 / ^15 (npm) | strings |
| `react-native-google-mobile-ads` | ^15 (npm) | AdMob; needs config plugin |
| `react-native-purchases` | ^9 (npm) | RevenueCat |
| `@sentry/react-native` | ~7 (npm, has Expo plugin) | crashes |
| `posthog-react-native` | ^4 (npm) | analytics |
| `zod` | ^4 (npm) | validate RPC payloads and env |
| `date-fns` | ^4 (npm) | daily set date math, Riga timezone |
| `react-native-url-polyfill` | ^2 (npm) | required by supabase-js on RN |

### Dev / tooling

| Package | Purpose |
|---------|---------|
| `typescript` ~5.9, `@types/react` | |
| `eas-cli` (global) | builds, submit, update, secrets |
| `supabase` CLI (scoop/npm) | local stack, migrations, type gen |
| `eslint` + `eslint-config-expo`, `prettier` | |
| `jest-expo`, `@testing-library/react-native` | scoring and state machine tests |
| `maestro` (optional, later) | e2e on simulator via EAS Workflows |

Type generation: `supabase gen types typescript --local > src/api/database.types.ts`
after every migration, committed to the repo.

## app.json / eas.json sketches

`app.config.ts` (dynamic config so env can switch bundle id and Supabase URL):

```ts
// app.config.ts
import { ExpoConfig } from 'expo/config';

const profile = process.env.APP_ENV ?? 'development'; // development | preview | production
const isProd = profile === 'production';

const config: ExpoConfig = {
  name: isProd ? 'Uzmini Cenu' : `Uzmini Cenu (${profile})`,
  slug: 'uzmini-cenu',
  scheme: 'uzminicenu',
  version: '1.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: isProd ? 'lv.uzminicenu.app' : `lv.uzminicenu.app.${profile}`, // placeholder, reserve in Phase 0
    buildNumber: '1',
    supportsTablet: false,
    usesAppleSignIn: true,
    associatedDomains: ['applinks:uzminicenu.lv', 'applinks:www.uzminicenu.lv'],
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSUserTrackingUsageDescription: 'Used to show relevant ads.', // only if ATT is used with AdMob
    },
    entitlements: {
      'aps-environment': isProd ? 'production' : 'development',
    },
  },
  android: {
    package: 'lv.uzminicenu.app',
    intentFilters: [{ action: 'VIEW', autoVerify: true,
      data: [{ scheme: 'https', host: 'uzminicenu.lv', pathPrefix: '/r' },
             { scheme: 'https', host: 'uzminicenu.lv', pathPrefix: '/d' }],
      category: ['BROWSABLE', 'DEFAULT'] }],
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-apple-authentication',
    'expo-localization',
    ['expo-notifications', { icon: './assets/notification-icon.png', color: '#ffffff' }],
    ['react-native-google-mobile-ads', {
      iosAppId: process.env.ADMOB_IOS_APP_ID ?? 'ca-app-pub-xxx~yyy',
      userTrackingUsageDescription: 'Used to show relevant ads.' }],
    ['@sentry/react-native/expo', { organization: 'uzminicenu', project: 'ios' }],
    ['expo-build-properties', { ios: { deploymentTarget: '15.1' } }],
  ],
  updates: { url: 'https://u.expo.dev/<EAS_PROJECT_ID>' },
  runtimeVersion: { policy: 'appVersion' },
  extra: {
    eas: { projectId: '<EAS_PROJECT_ID>' },
    appEnv: profile,
  },
};
export default config;
```

`eas.json`:

```json
{
  "cli": { "version": ">= 16.0.0", "appVersionSource": "remote" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "ios": { "simulator": false },
      "env": { "APP_ENV": "development" },
      "channel": "development"
    },
    "preview": {
      "distribution": "internal",
      "env": { "APP_ENV": "preview" },
      "channel": "preview"
    },
    "production": {
      "autoIncrement": true,
      "env": { "APP_ENV": "production" },
      "channel": "production"
    }
  },
  "submit": {
    "production": {
      "ios": {
        "appleId": "you@example.com",
        "ascAppId": "<APP_STORE_CONNECT_APP_ID>",
        "appleTeamId": "<TEAM_ID>"
      }
    }
  }
}
```

Notes:
- `distribution: internal` on iOS = ad-hoc provisioning. Register your iPhone
  UDID once with `eas device:create` (it sends a link to open on the phone).
- Preview builds go to TestFlight instead once external testers appear:
  switch `preview` to `distribution: store` and `eas submit --profile preview`.
- Universal links need `https://uzminicenu.lv/.well-known/apple-app-site-association`
  serving `{"applinks":{"details":[{"appIDs":["<TEAM_ID>.lv.uzminicenu.app"],"components":[{"/":"/r/*"},{"/":"/d/*"}]}]}}`.
  Host it on the static landing page (Cloudflare Pages).

## Environment variables

Client-side values must be prefixed `EXPO_PUBLIC_` and are baked into the
bundle; they are not secrets.

| Variable | Where | Notes |
|----------|-------|-------|
| `EXPO_PUBLIC_SUPABASE_URL` | app (.env, EAS env) | per profile |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | app | public by design, RLS protects |
| `EXPO_PUBLIC_POSTHOG_KEY`, `EXPO_PUBLIC_POSTHOG_HOST` | app | `https://eu.i.posthog.com` |
| `EXPO_PUBLIC_SENTRY_DSN` | app | |
| `EXPO_PUBLIC_REVENUECAT_IOS_KEY` | app | public SDK key |
| `EXPO_PUBLIC_ADMOB_INTERSTITIAL_ID`, `..._REWARDED_ID` | app | test ids in dev/preview |
| `SENTRY_AUTH_TOKEN` | EAS secret | source map upload at build |
| `APP_ENV` | eas.json | switches config |
| `ROUND_TOKEN_SECRET` | Supabase Vault | HMAC key, see below |
| `EXPO_ACCESS_TOKEN` | Supabase Edge Function secret | push sending (optional, raises rate limit) |
| `SCRAPER_CONTACT_EMAIL` | Edge Function secret | User-Agent |
| `DAILY_SEED_SECRET` | Supabase Vault | daily set selection |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Functions only (auto-injected) | never in app |

Local: `.env.local` (gitignored) read by Expo CLI; `supabase/.env` for
functions (`supabase functions serve --env-file`). EAS: `eas env:create
--environment production --name X --value Y --visibility secret`. Validate
`process.env` at startup with a `zod` schema so a missing variable fails
loudly in dev instead of producing a blank screen.

## High-level diagram

```
 iOS app (Expo) ──HTTPS──▶ Supabase Postgres (RLS) ◀── nightly scraper job
      │  ▲                   │
      │  └──Realtime WS──────┘  (duel / room channels)
      │
      ├──▶ portal CDN (listing photos, direct)
      └──▶ Expo Push ──▶ APNs ──▶ friend's phone
```

## App structure (Expo Router)

```
app/
  (tabs)/
    index.tsx          home: play, daily, friends
    daily.tsx
    friends.tsx
    profile.tsx
  play/[sessionId].tsx round screen (shared by all modes)
  duel/[duelId].tsx
  room/[code].tsx
  reveal/...           modal
src/
  api/        supabase client, typed RPC wrappers
  game/       scoring, round state machine, seeds
  realtime/   channel hooks for duel/room
  ui/
  i18n/       lv, ru, en
supabase/
  migrations/
  functions/  scrape-ss, build-daily, notify-duel
```

## Supabase client setup

```ts
// src/api/supabase.ts
import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { AppState } from 'react-native';
import type { Database } from './database.types';

const secureStorage = {
  getItem: (k: string) => SecureStore.getItemAsync(k),
  setItem: (k: string, v: string) => SecureStore.setItemAsync(k, v),
  removeItem: (k: string) => SecureStore.deleteItemAsync(k),
};
// SecureStore has a 2 KB value limit warning; Supabase sessions are ~1 KB
// but if refresh tokens grow, swap to AsyncStorage + encrypt or expo-sqlite.

export const supabase = createClient<Database>(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: { storage: secureStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
    realtime: { params: { eventsPerSecond: 10 } },
  },
);

// Keep tokens fresh only while the app is in the foreground.
AppState.addEventListener('change', (s) =>
  s === 'active' ? supabase.auth.startAutoRefresh() : supabase.auth.stopAutoRefresh());
```

### Anonymous first, Apple later

1. On first launch: `supabase.auth.signInAnonymously()`. Enable "Allow
   anonymous sign-ins" in Auth settings. The returned `user.id` is a real
   `auth.users` row with `is_anonymous = true`; a trigger creates the
   `profiles` row. All solo guesses are attributed to it.
2. When the player wants leaderboards/friends/duels:

```ts
import * as AppleAuthentication from 'expo-apple-authentication';

const cred = await AppleAuthentication.signInAsync({
  requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME],
});
// Link, do not sign in: keeps the same user id, so history and streaks survive.
const { error } = await supabase.auth.linkIdentity({
  provider: 'apple',
  token: cred.identityToken!,          // supabase-js >= 2.45 supports linkIdentity with idToken
});
// Fallback if the Apple account is already linked to another user:
// signInWithIdToken({ provider: 'apple', token }) and offer "merge progress" via RPC merge_profiles(old_anon_id).
```

3. Enable "manual linking" in Auth settings. Apple provider needs the
   Services ID / bundle id in the Supabase dashboard; for native iOS only
   the bundle id is required (no Services ID / secret key).
4. Anonymous users whose profile has no guesses for 30 days are purged
   by a weekly cron (`delete from auth.users where is_anonymous and ...`).
5. RLS distinguishes them where needed:
   `(auth.jwt() ->> 'is_anonymous')::boolean` must be false for
   `invite_duel`, `create_room`, `friendships`.

## Key flows

### Fetching rounds (solo)
Client calls RPC `get_rounds(category, region, n)` which returns n random
active listings without the price field, plus a signed `round_token`
per listing. On guess, client calls `submit_guess(round_token, guess)`
which returns the price and score. Price never ships to the client before
the guess, so cheating requires more than reading network traffic.

### Round token design

Purpose: bind one listing to one player, one context and one round, for a
limited time, single-use, without a server-side session table.

Payload (JSON, then base64url):

```json
{ "l": 48213, "u": "9f1c...-uuid", "c": "solo", "x": null, "r": 3, "e": 1735689600, "n": "b7e2f1" }
```

| Field | Meaning |
|-------|---------|
| `l` | listing_id |
| `u` | `auth.uid()` (anonymous or real user; device id is unnecessary because anonymous auth gives every device a uid) |
| `c` | context type: `solo`, `streak`, `daily`, `duel`, `room` |
| `x` | context id (daily day, duel uuid, room code) or null |
| `r` | round_no |
| `e` | expiry epoch seconds; solo 30 min, duel/room = deadline + 3 s grace |
| `n` | 6-hex nonce so identical payloads produce different tokens |

Token = `base64url(payload) + '.' + base64url(hmac_sha256(secret, base64url(payload)))`.

Secret: stored in **Supabase Vault** (`vault.create_secret('...', 'round_token_secret')`),
read inside the `security definer` function with
`select decrypted_secret from vault.decrypted_secrets where name = 'round_token_secret'`.
Only the function owner (postgres role) can read Vault; clients never can.
Rotation: keep `round_token_secret` and `round_token_secret_prev`, verify
against both for 1 hour after rotation.

Single-use: the `guesses` table has a unique index on
`(user_id, mode, context_id, listing_id)`; a second submit with the same
token hits the constraint and returns `already_answered`. No separate
nonce table needed. For solo (no context) the unique key includes the
nonce stored in `guesses.token_nonce`.

**Postgres (pgcrypto) vs Edge Function:** implement in Postgres.
`extensions.hmac(data bytea, key bytea, 'sha256')` from pgcrypto is one
line, keeps token issue and verification in the same transaction as the
guess insert, avoids an extra cold-start hop (Edge Functions add
100-400 ms), and the secret never leaves the database. An Edge Function
would only be needed if signing had to happen outside Postgres (it does
not). Full SQL is in 05-data-model.

### Daily challenge
`daily_sets` row for today is public (without prices). Guesses go through
`submit_daily`. One row per user per day enforced by a unique index.

### Duel / room
See 06-multiplayer.

### Push invite
`invite_duel(friend_id)` inserts a duel row and an Edge Function sends
an Expo push with `{ type: 'duel_invite', duelId }`. Tapping it deep-links
to `/duel/[duelId]`.

## Image loading strategy

- `expo-image` with `cachePolicy="disk"` and `recyclingKey={listingId}`.
  Photos are the round; a round is not shown until the first photo has
  resolved (`onLoad`), with a 4 s cap and then a "photo unavailable"
  placeholder so the game never stalls.
- **Prefetch next 2 rounds**: when round `n` becomes visible, call
  `Image.prefetch([...round n+1 photos[0..1], ...round n+2 photos[0]])`.
  Remaining carousel photos load lazily on swipe. Solo free play fetches
  rounds in batches of 10 from `get_rounds`, so the next 2 are always in
  memory.
- **Hotlink headers**: request photos with `headers: { Referer: '' }`
  omitted entirely (do not send our domain) and a normal Safari-like
  User-Agent, which is what expo-image sends by default. If the Phase 0
  probe shows SS.com's CDN checks `Referer`, set
  `Referer: https://www.ss.com/` on the `source` object. Never spoof beyond
  that; if they block, that is the signal to talk to them (see 09).
- **Fallback proxy** Edge Function `img-proxy`:
  - `GET /functions/v1/img-proxy?u=<encoded url>&sig=<hmac>`; the URL is
    signed by `get_rounds` so the proxy cannot be used as an open relay.
  - Allowlist hosts (`i.ss.com`, `*.city24.lv`).
  - Fetch upstream, store in Supabase Storage bucket `img-cache` with the
    sha1 of the URL as key, return with `Cache-Control: public, max-age=86400`.
  - Storage lifecycle: a daily cron deletes objects older than 24 h
    (`storage.objects` where `created_at < now() - interval '24 hours'`).
    This keeps the "we do not store photos" position honest: it is a
    transient cache, documented in 09.
  - Client switches to the proxy automatically when the direct load fails
    (`onError` -> retry via proxy URL), and reports the failure rate to
    PostHog (`image_direct_failed`). If it exceeds 20% for a day, flip the
    `image_mode` remote config flag to `proxy` for everyone.

## Push notifications end to end

1. **Registration** (after first sign-in that is not anonymous, or when the
   user accepts a duel invite deep link):

```ts
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';

export async function registerPush() {
  if (!Device.isDevice) return;
  const { status } = await Notifications.getPermissionsAsync();
  const final = status === 'granted' ? status : (await Notifications.requestPermissionsAsync()).status;
  if (final !== 'granted') return;
  const { data: token } = await Notifications.getExpoPushTokenAsync({
    projectId: Constants.expoConfig!.extra!.eas.projectId,
  });
  await supabase.rpc('set_push_token', { token });   // upsert into push_tokens (user_id, token, platform)
}
```

Ask for permission at a meaningful moment (first duel invite sent, or
"remind me about the daily"), never on cold start.

2. **Sending**: Edge Function `send-push` called by a database webhook
   (Supabase "Database Webhooks" on `duels` insert/update and on
   `daily_sets` insert) or directly from the RPC via `pg_net`. It reads
   `push_tokens` for the recipients and POSTs to
   `https://exp.host/--/api/v2/push/send` in chunks of 100 using the
   `expo-server-sdk` (Deno-compatible via npm specifier). Payload shape and
   per-event content are in 06-multiplayer.

3. **Receipts**: Expo returns a ticket id per message. Store tickets in
   `push_tickets (ticket_id, token, sent_at)`. A cron 15 min later calls
   `/--/api/v2/push/getReceipts`; on `DeviceNotRegistered` delete the token
   from `push_tokens`. On `MessageRateExceeded` back off. Without this,
   tokens rot and APNs eventually throttles the project.

4. **Foreground handling**: `Notifications.setNotificationHandler` shows
   an in-app banner for `duel_invite` and suppresses `duel_result` if the
   user is already on that duel screen.

5. **Deep link on cold start**: Expo Router handles URL-based links, but a
   tap on a push while the app is killed arrives as a notification
   response, not a URL. In the root layout:

```ts
useEffect(() => {
  // cold start
  Notifications.getLastNotificationResponseAsync().then((r) => {
    const data = r?.notification.request.content.data as PushData | undefined;
    if (data) router.push(routeFor(data));
  });
  // warm start / background
  const sub = Notifications.addNotificationResponseReceivedListener((r) =>
    router.push(routeFor(r.notification.request.content.data as PushData)));
  return () => sub.remove();
}, []);

const routeFor = (d: PushData) =>
  d.type === 'duel_invite' || d.type === 'duel_result' ? `/duel/${d.duelId}`
  : d.type === 'room_invite' ? `/room/${d.code}`
  : '/daily';
```

Also include `url: 'uzminicenu://duel/<id>'` in the push data so
`expo-linking` can handle it on Android where `getLastNotificationResponseAsync`
behaves differently. Guard against pushing a route before the auth session
has loaded: queue the route in Zustand and consume it once `session` is
resolved.

## i18n

- `i18next` + `react-i18next` + `expo-localization`. Detect
  `getLocales()[0].languageCode`, map `lv|ru|en`, default `lv`, persisted
  override in `profiles.lang` and locally in Zustand.
- Layout:

```
src/i18n/
  index.ts          init, resources, language detector
  lv/common.json    buttons, tabs, errors
  lv/game.json      round screen, reveal, hints
  lv/daily.json
  lv/multiplayer.json
  lv/store.json     premium, ads copy
  ru/...            same files
  en/...            same files
```

- Keys are semantic (`reveal.yourGuess`), not English sentences. Plurals via
  i18next's plural rules; Latvian has `one`/`other` plus a zero form, Russian
  `one`/`few`/`many`, both supported by `Intl.PluralRules` (bundled in Hermes).
- Numbers and EUR via `Intl.NumberFormat('lv-LV', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })`
  so 45 000 € renders with the Latvian space separator.
- Category and attribute labels come from the DB in all three languages
  (`categories.labels jsonb`) so the scraper can add one without an app
  release.
- A `scripts/i18n-check.ts` fails CI if any key exists in `lv` but not in
  `ru`/`en`.

## Error handling and offline

- Every RPC wrapper returns `Result<T, AppError>`; `AppError` codes come from
  Postgres `raise exception using errcode = 'P0001', message = 'token_expired'`
  and are mapped to i18n keys. Unknown errors go to Sentry with the RPC name.
- Retry policy (TanStack Query): reads retry 2x with backoff; mutations
  (`submit_guess`) retry once only on network error, never on 4xx, because a
  double submit would return `already_answered` anyway (idempotent by design).
- Network state via `@react-native-community/netinfo` (SDK-pinned):
  - offline + solo free play: continue from the prefetched batch (prices
    included in an offline batch fetched via `get_offline_pack(n=10)`, which
    is rate-limited to 3 packs/hour and never writes leaderboards).
  - offline + daily/duel/room: block with a "Nav interneta" sheet and an
    automatic resume when `isConnected` flips; Realtime channels
    re-subscribe automatically and the screen refetches the row.
- Guess submissions that fail mid-flight are kept in a Zustand
  `pendingGuesses` queue persisted to disk and flushed on reconnect; tokens
  carry their own expiry so stale ones are dropped with a toast.
- Error boundaries per route group; a crashed round screen resets to home,
  never a white screen.

## Performance budgets

| Metric | Budget | How |
|--------|--------|-----|
| Cold start to interactive home | < 1.5 s on iPhone 11 | Hermes, no heavy work before first render, lazy-load ads/IAP SDKs after home renders |
| Round transition (tap "next" to next photo visible) | < 300 ms | next 2 rounds prefetched, `recyclingKey`, no layout jump |
| Guess submit to reveal start | < 500 ms p95 | single RPC, no Edge Function hop, EU region |
| Reveal animation | 60 fps | Reanimated worklets, count-up on UI thread |
| JS bundle | < 4 MB | no moment.js, tree-shaken i18n resources |
| Realtime event to UI | < 200 ms | postgres_changes on filtered channel |
| Memory | < 250 MB | cap expo-image memory cache, recycle carousel |

Measure with `@shopify/react-native-performance` markers or PostHog
`$performance` events on `app_start`, `round_shown`, `reveal_shown`.

## Security checklist

- [ ] RLS enabled on every table; `listings` has no client policies at all.
- [ ] All game RPCs `security definer` with `set search_path = public, extensions`
      and `revoke execute from public; grant execute to authenticated`.
- [ ] Round token HMAC secret in Vault, never in Edge Function env.
- [ ] Anonymous users cannot call `invite_duel`, `create_room`, friendship RPCs.
- [ ] Rate limits in RPCs (see 06) backed by a `rate_limits` table, plus
      Supabase Auth rate limits for anonymous sign-ups.
- [ ] `submit_guess` clamps `guess_eur` to `[1, 100_000_000]`.
- [ ] Service role key only in Edge Functions and CI, never in the app.
- [ ] Image proxy URL signing and host allowlist.
- [ ] Deep-link parameters validated (`duelId` is a uuid, `code` matches `^[BCDFGHJKLMNPQRSTVWXZ]{4}$`).
- [ ] Sentry scrubs `push_token`, `access_token` from breadcrumbs.
- [ ] Apple App Transport Security default (HTTPS only); no exceptions.
- [ ] Account deletion RPC `delete_me()` removes profile, tokens, friendships,
      anonymises guesses (see 05).
- [ ] Dependency audit in CI (`npm audit --omit=dev`), Dependabot weekly.

## Observability

**Sentry**: `@sentry/react-native` with the Expo plugin; source maps uploaded
by EAS at build (`SENTRY_AUTH_TOKEN`). `tracesSampleRate: 0.2`, tag every
event with `appEnv`, `updateId` (from `expo-updates`), `userId` hashed.

**PostHog** (EU host). Event naming: `snake_case`, `object_verb`,
past tense, one namespace per area:

| Event | Properties |
|-------|------------|
| `app_opened` | `cold_start`, `from_push_type` |
| `round_shown` | `mode`, `category`, `round_no`, `photo_load_ms` |
| `guess_submitted` | `mode`, `category`, `error_pct`, `score`, `time_to_guess_ms` |
| `session_finished` | `mode`, `rounds`, `total` |
| `daily_completed` | `total`, `grid` |
| `daily_shared` | `channel` (ios share sheet target if known) |
| `duel_invited`, `duel_accepted`, `duel_declined`, `duel_expired`, `duel_finished` | `duel_id`, `time_to_accept_s` |
| `room_created`, `room_joined`, `room_started`, `room_finished` | `code`, `players` |
| `ad_shown`, `ad_rewarded` | `placement` |
| `paywall_shown`, `trial_started`, `subscription_started` | `plan` |
| `image_direct_failed` | `host` |
| `signin_completed` | `provider` (`anonymous`, `apple`) |

Identify users with the Supabase uid; call `posthog.alias` when an anonymous
user links Apple. Feature flags for `image_mode`, `k_factor` (scoring tune),
`ads_enabled`.

## Local dev workflow on Windows

Prerequisites: Node 22 LTS (via `fnm` or `nvm-windows`), Git, Docker Desktop
(WSL 2 backend), `scoop install supabase`, `npm i -g eas-cli`, an Expo
account, an Apple Developer account, iPhone on the same Wi-Fi as the PC.

1. **Repo**: `npx create-expo-app@latest uzmini-cenu -t tabs` (Expo Router
   template), `cd`, `git init`.
2. **Supabase local**: `supabase init`, `supabase start` (pulls Postgres,
   Auth, Realtime, Studio, Inbucket into Docker; first start ~5 min).
   Studio at `http://127.0.0.1:54323`. Write migrations in
   `supabase/migrations/`, apply with `supabase db reset` (drops and replays
   everything + `seed.sql`). Generate types after each change.
3. **Reach local Supabase from the phone**: Docker binds to the PC's LAN IP,
   so set `EXPO_PUBLIC_SUPABASE_URL=http://192.168.x.y:54321` in
   `.env.local`. Open Windows Firewall for ports 54321 and 8081 on the
   private network profile. Realtime works over ws on the LAN. If Docker on
   WSL 2 does not expose the port, add a `netsh interface portproxy` rule
   or simply use a second cloud Supabase project as `dev`.
4. **Edge Functions locally**: `supabase functions serve --env-file supabase/.env`
   and hit `http://192.168.x.y:54321/functions/v1/<name>`.
5. **Dev client**: `eas login`, `eas init`, `eas device:create` (register
   iPhone), then `eas build --platform ios --profile development`. Cloud
   build takes 10-20 min. Install from the QR / link on the phone. Rebuild
   only when native modules or config plugins change.
6. **Iterate**: `npx expo start --dev-client` (add `--tunnel` if Wi-Fi
   isolation blocks LAN). Scan QR with the camera; the dev client opens. Fast
   refresh works as on Android.
7. **Test push**: send to the token printed in the dev client via
   `https://expo.dev/notifications` tool.
8. **Preview build for friends**: `eas build --profile preview --platform ios`,
   share the install link (ad-hoc, needs their UDID) or later TestFlight.
9. **Production**: `eas build --profile production --platform ios` then
   `eas submit --platform ios --latest`. EAS handles certificates and
   provisioning profiles; no Xcode. App Store metadata via App Store Connect
   in the browser.
10. **OTA**: `eas update --channel production --message "fix scoring"` for
    JS-only changes matching the current `runtimeVersion`.

Simulators: none on Windows. Use the physical iPhone for iOS, and an Android
emulator (Android Studio) for fast UI iteration and the two-device
multiplayer tests (see 06).

## CI/CD with GitHub Actions

```yaml
# .github/workflows/ci.yml
name: ci
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run typecheck && npm run lint && npm test -- --ci
      - run: npx tsx scripts/i18n-check.ts
      - uses: supabase/setup-cli@v1
      - run: supabase db start && supabase db lint && supabase test db   # pgTAP tests for RPCs
```

```yaml
# .github/workflows/release.yml
name: release
on:
  push:
    tags: ['v*']
jobs:
  build-ios:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - uses: expo/expo-github-action@v8
        with: { eas-version: latest, token: ${{ secrets.EXPO_TOKEN }} }
      - run: npm ci
      - run: eas build --platform ios --profile production --non-interactive --no-wait
      # --auto-submit can be appended once TestFlight review is routine
  migrate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
      - run: supabase link --project-ref ${{ secrets.SUPABASE_PROJECT_REF }}
        env: { SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }} }
      - run: supabase db push
        env: { SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }} }
      - run: supabase functions deploy --no-verify-jwt=false
```

- `main` push: run `eas update --channel preview --auto` for OTA to the
  preview build.
- Migrations deploy before the app build so the new RPCs exist when the
  binary reaches TestFlight.
- Alternatively use **EAS Workflows** (`.eas/workflows/*.yml`), which can
  run the same build + submit steps without GitHub minutes; GitHub Actions
  is kept for tests and Supabase deploy.

## Build & release (no Mac)

1. `eas build --platform ios --profile development` for a dev client with
   AdMob + IAP native modules. Install via TestFlight or ad-hoc.
2. Iterate with `expo start --dev-client` on Windows, phone on same Wi-Fi.
3. `eas build --profile production` + `eas submit` to App Store Connect.
4. `eas update` for JS-only hotfixes.

Apple Developer account (€99/yr) needed before step 1 for device provisioning.

## Environments

- `dev`: local Supabase (Docker) or a second Supabase project. Scraper writes
  a small sample.
- `prod`: EU Supabase project. Scraper on cron.

Secrets via EAS secrets and Supabase vault. Never in the repo.

## Cost estimate per month

Assumptions: 1 MAU plays ~8 sessions/month, ~60 rounds, ~40 photos viewed
per session from the portal CDN (not our bandwidth). Realtime: duels/rooms
are ~10% of sessions.

| Item | 0 MAU (dev) | 1k MAU | 10k MAU |
|------|-------------|--------|---------|
| Supabase | €0 (free; pauses after 7 days idle, so use Pro from beta) | €25 Pro | €25 Pro + ~€10 extra Realtime/DB egress |
| EAS | €0 (free tier, 30 builds/mo, slow queue) | €0-19 (Starter if queue hurts) | €19 Starter |
| Apple Developer | €8 (99/yr) | €8 | €8 |
| Domain + Cloudflare Pages | €1 | €1 | €1 |
| Expo Push | €0 | €0 | €0 |
| PostHog EU | €0 (1M events free) | €0 | €0-15 (~3M events) |
| Sentry | €0 (5k errors) | €0 | €0-26 Team |
| RevenueCat | €0 | €0 (free to $2.5k MTR) | €0 |
| Image proxy egress (only if enabled) | €0 | ~€5 | ~€40 (Storage egress ~2 TB) |
| Scraper VPS (only if Edge Function limits bite) | €0 | €5 | €5 |
| **Total** | **~€9** | **~€40-60** | **~€110-150** |

Revenue side at 10k MAU: 1.5% premium ≈ 150 x €2.99 ≈ €450 + interstitial
ads (Latvia eCPM ~€2, ~1.2M impressions) ≈ €200-400. Break-even is
realistic around 3-5k MAU; below that it is a hobby budget of a coffee a
day.
