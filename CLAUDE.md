# Uzmini Cenu — repo guide

Latvian guess-the-price game. Expo SDK 57 / Expo Router / TypeScript app at
the repo root, Supabase backend in `supabase/`, Node scraper in `scraper/`,
Phase 0 probe in `tools/probe/`. Full plan in `docs/` (read 01, 02, 11, 08
first; 04-06 and 12 for implementation).

## Layout and ownership

| Path | What |
|------|------|
| `app/` | Expo Router routes only. No business logic. |
| `src/api/` | `supabase.ts` client, `rpc.ts` typed RPC wrappers (**the contract**), `types.ts` |
| `src/auth/` | zustand auth store (anonymous device accounts + username gate) |
| `src/game/` | scoring, formatting, round state machine, session stores |
| `src/realtime/` | duel/room channel hooks |
| `src/notifications/` | push registration + deep-link routing |
| `src/monetization/` | ads only, behind `env.ADS_ENABLED` (off at launch; no IAP) |
| `src/ui/` | theme tokens + shared components |
| `src/i18n/{lv,ru,en}/{common,social}.json` | strings; `common` = core game, `social` = friends/duels/rooms |
| `supabase/migrations/` | SQL, numbered per docs/05 naming plan |
| `supabase/functions/` | Edge Functions (send-push, build-daily, scrape-ss, sweep) |
| `scraper/` | standalone Node package, shares parsers with `tools/probe` |

## Rules

- Prices never reach the client before a guess. RPCs strip `price_eur`; duel/room prices live in `context_prices`.
- Every RPC the app calls must exist in `src/api/rpc.ts` AND in a migration with the same name and argument names (`p_*`).
- Use `npx expo install <pkg>` for anything Expo/RN. Run `npm run typecheck` and `npm test` before declaring done.
- Photos are hotlinked from `i.ss.com`; never download them into Storage.
- Never edit `ios/` or `android/`; configure via `app.config.ts`.
- Strings: never hardcode UI text, use `t('...')` with keys in the right namespace.
- Dark theme only for v1; use tokens from `src/ui/theme.ts`.

## Commands

```bash
npm run typecheck      # tsc
npm test               # vitest (scoring, parsers, tokens)
npx expo start --dev-client
npx eas-cli build --profile development --platform ios
npx supabase db push   # after `supabase link`
```
