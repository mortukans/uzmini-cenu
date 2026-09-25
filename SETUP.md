# Setup for testing on your iPhone

Everything below is done once. Steps marked **(you)** need your accounts;
I cannot do them for you.

## 1. Supabase project (you, ~10 min)

1. https://supabase.com → New project → region **Frankfurt (eu-central-1)**.
   Save the database password.
2. Project Settings → API: copy **Project URL** and **anon public** key into
   `.env` (copy `.env.example`). Copy the **service_role** key into
   `scraper/.env` only, never into the app.
3. Authentication → Providers: enable **Anonymous sign-ins**. That is the
   only auth method: every device is an anonymous user that picks a username
   in the app (no Apple / e-mail providers needed).
4. Database → Extensions: make sure `pg_cron`, `pg_net`, `pgcrypto` are on.

Then from the repo root:

```bash
npx supabase login
```

```bash
npx supabase link --project-ref YOUR_PROJECT_REF
```

```bash
npx supabase db push
```

```bash
npx supabase db query --file supabase/seed.sql
```

Details, secrets and edge-function deploys: `supabase/README.md`.

## 2. Real listings instead of seed data (optional for first test)

```bash
cd scraper && npm install && cp .env.example .env
```

Fill `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SCRAPER_MAILTO`, then:

```bash
npm run scrape -- run --limit 200
```

The seed already gives ~40 fake listings with placeholder photos, enough to
click through every screen.

## 3. Expo / EAS (you, ~15 min)

1. https://expo.dev account. `npx eas-cli login`.
2. `npx eas-cli init` in the repo root → creates the EAS project id; put it
   in `.env` as `EAS_PROJECT_ID=...` (used by `app.config.ts`).
3. Apple Developer Program membership (€99/yr) is required for **any** iOS
   device build, including the dev client. Enrol at
   https://developer.apple.com/programs/enroll/ (individual, 24–48 h).
4. First device build:

```bash
npx eas-cli build --profile development --platform ios
```

EAS asks to register your iPhone (ad-hoc provisioning) via a link you open
on the phone. When the build finishes, install it from the QR code.

5. Start the JS server on your PC and open the dev client on the phone (same
   Wi-Fi):

```bash
npx expo start --dev-client
```

Until the Apple account exists you can still run the app in the browser to
click through screens (no push, no ads):

```bash
npx expo start --web
```

## 4. Optional services

| Service | Where the key goes | Needed for |
|---|---|---|
| AdMob (unit ids) | `EXPO_PUBLIC_ADMOB_*`, `EXPO_PUBLIC_ADS_ENABLED=true`, app ids in `app.config.ts` | ads (off at launch) |
| PostHog EU | `EXPO_PUBLIC_POSTHOG_KEY` | analytics |
| Sentry | `EXPO_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT` | crashes |
| Expo push | nothing extra; EAS project id + APNs key uploaded via `eas credentials` | duel invites |

All of these are off by default and the app runs without them.

## 5. Daily set

The daily challenge needs a `daily_sets` row for today. The seed creates one
for the day you run it. For every following day either deploy the
`build-daily` edge function with its cron (see `supabase/README.md`) or run
it manually:

```bash
npx supabase functions invoke build-daily
```
