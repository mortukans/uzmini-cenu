# Uzmini Cenu — Supabase backend

Postgres schema, RPCs, RLS, cron and Edge Functions for the app. The contract
with the client is `src/api/rpc.ts` (names + `p_*` args) and `src/api/types.ts`
(JSON shapes); `docs/05-data-model.md` and `docs/06-multiplayer.md` are the design.

```
supabase/
  config.toml                 local stack config (anonymous sign-ins on, private schema hidden)
  migrations/                 19 files, one concern each (see naming plan in docs/05)
  seed.sql                    dev data: categories, 40 fake listings, today's daily set, dev token secret
  functions/
    _shared/                  cors/json helpers, service client + caller auth, Expo push helpers
    send-push/                pg_net -> Expo Push (all events in docs/06)
    build-daily/              deterministic daily set builder (docs/03)
    sweep/                    fallback for the pg_cron deadline sweep
  tests/
    check-rpc-parity.mjs      rpc.ts <-> migrations name/argument/grant check (node, offline)
    smoke.sql                 plain SQL smoke test: score(), tokens, get_rounds, daily, duel, room, RLS
```

Prices never leave the database before a guess: `listings` and
`context_prices` have RLS on and **no policies**; every read goes through
`security definer` RPCs that call `private.strip()`. Duel/room/daily
snapshots are price-free; prices live in `context_prices`.

## 1. Local (needs Docker)

```bash
npx supabase start                 # first run pulls images
npx supabase db reset              # replays migrations + seed.sql
npx supabase status                # URLs + keys; Studio at http://127.0.0.1:54323
```

Seed sets the dev token secret both in Vault and as the GUC
`app.settings.token_secret` (GUC applies to *new* sessions; Vault is immediate).

Edge Functions locally:

```bash
cp supabase/.env.example supabase/.env      # create it: DAILY_SEED_SECRET=..., EXPO_ACCESS_TOKEN=...
npx supabase functions serve --env-file supabase/.env
curl -X POST 'http://127.0.0.1:54321/functions/v1/build-daily?today=1' -H "Authorization: Bearer $SERVICE_ROLE_KEY"
```

Smoke test (after `db reset`):

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/tests/smoke.sql
```

Offline contract check (no Docker needed): `node supabase/tests/check-rpc-parity.mjs`.

## 2. Hosted project (EU / Frankfurt)

```bash
npx supabase login
npx supabase link --project-ref <ref>
npx supabase db push                # applies supabase/migrations in order
```

### Secrets and settings the SQL reads

Run once per environment in the SQL editor (never in a migration):

```sql
-- HMAC key for round tokens (docs/04). Rotate by replacing the secret; tokens are short-lived.
select vault.create_secret('<64 random chars>', 'round_token_secret', 'round token HMAC');

-- where private.notify() posts (send-push) and how it authenticates
alter database postgres set app.settings.functions_url = 'https://<ref>.supabase.co/functions/v1';
select vault.create_secret('<service role key>', 'service_key', 'used by private.notify / pg_cron http');
-- or, less nice: alter database postgres set app.settings.service_key = '<service role key>';
```

Dev fallback for the token key without Vault:
`alter database postgres set app.settings.token_secret = 'dev-secret-not-for-prod';`
(Vault wins when both exist.)

Settings via `alter database ... set` apply to new connections; PostgREST
pools reconnect within minutes, or restart the project's API from the dashboard.

### Auth dashboard settings

Authentication → Providers:

- **Anonymous sign-ins**: enable. It is the only auth method: every device
  is an anonymous user that chooses a username in the app (`set_username`).
- Rate limits: keep the default 30 anonymous sign-ups / hour / IP.

### Edge Functions

```bash
npx supabase secrets set DAILY_SEED_SECRET=<long random> EXPO_ACCESS_TOKEN=<optional> NOTIFY_DAILY=0
npx supabase functions deploy send-push   --no-verify-jwt
npx supabase functions deploy build-daily --no-verify-jwt
npx supabase functions deploy sweep       --no-verify-jwt
```

`--no-verify-jwt` because the callers are pg_net / pg_cron, not users; each
function checks `Authorization: Bearer <service role key>` (or
`INTERNAL_SECRET`) itself and returns 401 otherwise.

### Cron

Migration 17 schedules (guarded, only when `pg_cron` exists):

| job | schedule | what |
|-----|----------|------|
| `sweep-deadlines` | every 10 s | `private.sweep_deadlines()` — deadline backstop, 24 h async, 7 d expiry |
| `retention-nightly` | 03:30 UTC | `private.run_retention()` |
| `purge-anon-weekly` | Mon 04:00 UTC | delete anonymous users idle 30 d |
| `push-receipts` | */15 min | POST `<functions_url>/push-receipts` (function not yet written; harmless 404 until then) |
| `build-daily` | 20:00 UTC | POST `<functions_url>/build-daily` → builds **tomorrow's** set |

Enable `pg_cron` and `pg_net` under Database → Extensions before `db push`
if the project does not have them on. If seconds-level schedules are
rejected, re-schedule: `select cron.schedule('sweep-deadlines', '* * * * *', 'select private.sweep_deadlines()');`
and/or hit the `sweep` function from an external cron.

First daily set on a fresh project (today, not tomorrow):

```bash
curl -X POST 'https://<ref>.supabase.co/functions/v1/build-daily?today=1' -H "Authorization: Bearer $SERVICE_ROLE_KEY"
```

### Seed on hosted dev project

`seed.sql` is for local only; on a hosted *dev* project you can still run it
from the SQL editor (it is idempotent), but never on prod.

## 3. Conventions

- One concern per migration, never edit an applied one; new file via
  `npx supabase migration new <slug>`.
- Every RPC: `security definer`, `set search_path = public, extensions`,
  `revoke ... from public; grant execute ... to authenticated` (migration 15
  holds all grants). Errors are `raise exception '<code>'` with stable codes
  listed in `src/api/types.ts` (`RpcErrorCode`).
- Helpers the client must never reach live in schema `private` (not exposed
  by PostgREST).
- After changing tables, update `src/api/database.types.ts` (hand-written
  until `supabase gen types typescript --local` can run).
- Run `node supabase/tests/check-rpc-parity.mjs` before committing.

## 4. Deviations from docs/05 (intentional)

- `guesses.context_id` is `text` from the start; `profiles.push_token` never
  existed (push_tokens table instead); duel/room extra columns are in the
  base `create table`.
- No `duels_public` / `rooms_public` views: the `context_prices` decision in
  docs/05 makes snapshots price-free, so clients read `duels`/`rooms` directly
  under RLS (which is what `src/api/rpc.ts` does).
- `submit_guess` stores `token_nonce` only for solo/streak; for
  daily/duel/room it is NULL so a re-issued token can not answer the same
  listing twice (`guesses_once_idx` is `nulls not distinct`).
- Hourly limits (`get_rounds` 60/h, `get_offline_pack` 3/h or 10/h premium,
  `join_room` 30/h) reuse `rate_limits` by folding the Riga hour into `action`.
- `poke(p_ctx, p_ctx_id)` uses the argument names from `rpc.ts` (docs/06 says `p_id`).
- `rooms`: clients may update only `category`/`rounds` (docs granted `status` too);
  status changes only via `start_room` / `close_round`.
- Extra RPCs required by `rpc.ts` and not spelled out in docs/05:
  `my_rank`, `decline_duel`, `poke`, `request_friend`, `accept_friend`,
  `remove_friend`, `list_friends`, `register_push_token`, `run_sweep`
  (service role only).
- Push `data.type` follows `src/api/types.ts` (`duel_finished`, `daily_ready`)
  rather than the docs/06 table (`duel_result`, `daily`).
- `duel_your_turn` reminders and the `push-receipts` function are not
  implemented yet (cron entry exists).
