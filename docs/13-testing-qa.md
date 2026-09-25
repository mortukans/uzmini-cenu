# 13 Testing and QA

Solo dev rule: test what breaks silently (scoring, tokens, parsers, RLS),
smoke-test what breaks loudly (UI), and let 30 beta testers find the rest.
No coverage targets; every table below is a list of specific cases.

## Toolchain

| Layer | Tool | Runs where |
|-------|------|------------|
| Unit (TS) | Vitest, shared between `src/` and `supabase/functions/` | Windows, CI |
| Unit (SQL) | pgTAP via `supabase test db` | local Supabase (Docker), CI |
| Integration | Vitest + supabase-js against `supabase start` | Windows Docker, CI |
| E2E | Maestro Cloud (or Maestro CLI on a rented Mac mini hour) against the EAS dev / preview build | cloud; no Mac locally |
| Component | React Native Testing Library for the numeric pad and reveal | Windows, CI |
| Static | TypeScript strict, ESLint, `supabase db lint` | pre-commit, CI |
| CI | GitHub Actions: unit + SQL + integration on every PR; E2E nightly on `main` | |

## Unit tests

### Scoring (`src/game/score.ts`)

| Case | Input | Expected |
|------|-------|----------|
| exact | guess = price | 1000 |
| table values from 02 | err 5% / 10% / 25% / 50% | 670 / 449 / 135 / 18 (±1 for rounding) |
| symmetry | guess = 0.8p and 1.2p | equal scores |
| over 100% error | guess = 3p | score ≥ 0, monotone decreasing |
| zero / negative guess | 0, -5 | 0 points, no NaN, no throw |
| price 0 or null | | throws a typed error; listing must never have price 0 (filter guarantees) |
| grid colour | err 9.9% / 10% / 24.9% / 25% / 30% | 🟩 / 🟩 / 🟨 / 🟨 / 🟥 (boundaries inclusive as decided in P1.11) |
| k tuning | k from config | same fixtures re-run with k=6, 10 to make sure config is honoured |
| streak rule | "within 15%" and higher/lower | boolean results across boundaries |
| hint cost | max score 1000, hints 1/2/3 | reduced ceiling per 02 percentages |
| daily total | 5 scores | sum, share text exactly matches `Uzmini Cenu #37  3,410 / 5,000` format with thousands separators and the day number |

### Round token (`supabase/functions/_shared/token.ts` and SQL)

| Case | Expected |
|------|----------|
| sign then verify | payload round-trips (listing id, user/session id, context id, round no, issued_at) |
| tampered payload | verify fails |
| wrong secret | verify fails |
| expired (> 30 min) | verify fails with `expired` |
| replay | second `submit_guess` with same token returns `token_used` |
| cross-user | token issued to session A, submitted by session B fails |
| cross-context | duel token used in solo submit fails |
| clock skew | issued_at 60 s in the future still verifies (tolerance) |

### Parsers (`scraper/parsers/*.ts`)

Fixtures: saved HTML from the P0.1 probe in `scraper/fixtures/<source>/<category>/<n>.html`,
refreshed manually when a parser breaks. Never fetch live in unit tests.

| Case | Expected |
|------|----------|
| list page → detail URLs | correct count, absolute URLs, no duplicates |
| flats detail | price (int EUR), rooms, m2, floor/total, series, district, deal type = sale, photo URLs ≥ 2 |
| houses detail | price, m2, land m2, year, town |
| cars detail | price, make, model, year, km, engine, gearbox |
| random detail | price, sanitised title, condition, ≥ 1 photo |
| rent listing | `deal_type = rent` → rejected by filter |
| "cena pēc vienošanās" | price null → rejected |
| price in Ls or with "€/mēn." | rejected or converted per rule; never silently stored |
| title with price leak ("35000 EUR", "35 000 €", "35k") | scrubbed to `title_hint` without digits + currency |
| PII scrub | fixtures with phone formats `+371 2xxxxxxx`, `2x xxx xxx`, `2xxxxxxx`, emails, "Zvanīt Jānim" names → all removed |
| location granularity | street + house number never appears in `location` |
| region mapping | district → `riga`, Pierīga towns → `riga_region`, else `latvia` |
| HTML drift | parser returns a structured `ParseError` with the missing field name, not undefined |
| dedupe | same photo phash or same attributes+district → `duplicate_of` set |
| photo filters | fewer than 2 photos (flats/houses/cars) → rejected; stock/logo phash → rejected |

### Other units

- Daily seed: `hash(date + secret)` picks the same 5 ids for the same date
  and different for adjacent dates; category mix is 2/1/1/1; only listings
  active ≥ 24 h eligible.
- Room code generator: 4 consonants, no vowels, no `SS`, collision retry.
- i18n: every key in `lv.json` exists in `ru.json` and `en.json` (test
  fails on missing keys; stubs allowed as `"__TODO__"` before launch, not
  after).
- Numeric pad reducer: step buttons per category, max 9 digits, no leading
  zeros, backspace, clear.

## Integration tests (local Supabase)

`supabase start`, apply migrations, seed 50 listings from fixtures, run
Vitest with the anon key and two test JWTs.

| Case | Expected |
|------|----------|
| RLS: `select * from listings` with anon key | 0 rows / permission error |
| RLS: `select price_eur` via any client path | impossible; `get_rounds` result has no `price_eur` |
| `get_rounds('flats','riga',10)` | 10 distinct active flats, all `checked_at < 72h`, each with a token |
| `submit_guess` happy path | inserts `guesses` row, returns price and score matching the TS scorer |
| `submit_guess` replay | error `token_used` |
| `get_daily` before `build_daily` ran | error `no_set`; after: 5 items, no prices, `already_played=false` |
| `submit_daily` twice | second call fails on unique `(day, user_id)` |
| `build_daily` snapshot | prices frozen; expiring the listing afterwards does not change the set |
| `invite_duel` | duel row, snapshot with prices, opponent cannot read prices before guessing, Edge Function invoked (mock push) |
| duel round sync | both guesses for round 1 → `scores` updated, Realtime event received by a subscribed client |
| duel cap | 4th `invite_duel` in a day for a non-premium user → `duel_cap` error; premium user passes |
| `leaderboard('global','day')` | ordering, ties, own rank |
| account deletion RPC | `profiles`, `guesses`, `daily_results`, `friendships`, push token gone; `auth.users` row deleted |
| scraper end to end on fixtures | runs against a local HTTP server serving fixtures; 0 duplicates on second run; rejected rows carry `reject_reason` |
| kill switch | `update listings set status='rejected' where source='ss'` → `get_rounds` returns only other sources or empty; no error in the client path |
| pg_cron jobs | `build_daily` and duel expiry registered and callable manually |

## E2E with Maestro on the EAS dev build

No Mac: run Maestro Cloud against the `preview` EAS build (`.app` simulator
build), or run flows manually via TestFlight and treat Maestro as
nightly-only. Flows live in `e2e/*.yaml`, use `testID`s.

| Flow | Steps | Assert |
|------|-------|--------|
| `onboarding.yaml` | fresh install → 3 practice rounds → skip sign-in | reaches home in < 60 s, no sign-in prompt before round 3 |
| `solo_10_rounds.yaml` | pick flats / Riga → 10 rounds with fixed guesses | session summary visible; interstitial placeholder shown after round 5 and 10 (test ad unit) |
| `daily_play_share.yaml` | open daily → 5 guesses → result | grid text present; share sheet opens; second open shows "already played" |
| `signin_apple.yaml` | settings → Sign in with Apple (sandbox tester) | username picker appears; profile shows username |
| `duel_two_devices.yaml` | two simulators: A invites B, B accepts, both guess 5 rounds | both see the same reveal per round; final result identical on both |
| `paywall_trial.yaml` | settings → Plus → trial (sandbox) | ads gone; duel cap lifted |
| `delete_account.yaml` | settings → delete → confirm | back to anonymous state; leaderboard row gone |
| `language_switch.yaml` | switch lv → ru → en | key screens have no `__TODO__` or raw keys |
| `deep_link.yaml` | open `uzminicenu://daily` and universal link | lands on the daily screen |
| `offline_solo.yaml` | airplane mode after prefetch | 10 rounds playable, guesses not on the leaderboard afterwards |

Run before every TestFlight build; a failing flow blocks the build.

## TestFlight beta plan (P4.7)

### Recruitment

- Target 30 external testers plus 5 internal.
- Mix: 10 close friends (fast feedback), 10 from a Latvian Facebook or
  Discord group post ("meklēju 10 cilvēkus, kas 2 nedēļas spēlēs spēli par
  SS cenām"), 5 Russian-speaking, 5 people actively flat- or car-hunting,
  at least 8 who do not know you personally.
- Public TestFlight link with a 30-seat cap; ask for first name, phone
  model, language, and whether they play Wordle-type games.
- Devices: at least one iPhone SE (small screen), one iPhone 11 (older
  GPU), one Pro Max, iOS current and current minus 1.

### Schedule

| Day | Build | Focus |
|-----|-------|-------|
| 1 | beta 1 | install, onboarding, 10 solo rounds, first daily |
| 4 | beta 2 | fixes from day 1-3; ask everyone to play the daily every day |
| 8 | beta 3 | duel: pair testers up by group chat; ads and paywall (sandbox) |
| 11 | beta 4 | scoring feel changes if any; language check with ru testers |
| 14 | feedback form deadline; retro | |

### Feedback form (Google Form or Tally, lv with en toggle), sent day 7 and day 14

1. How many days out of the last 7 did you play the daily challenge?
   (0-7)
2. Did the score feel fair? (1-5) Which reveal felt most wrong and why?
3. Which category is the most fun? Which is the least? (flats / houses /
   cars / random)
4. Did you share your grid with anyone? Where? If not, why not?
5. Did you send or accept a duel? How did the waiting feel?
6. Was anything confusing in the first 2 minutes?
7. Did any listing show something it should not (phone, address, price in
   the title, offensive item)? Which one?
8. Ads: annoying, fine, or did not notice? Would you pay €14.99/year to
   remove them and get unlimited duels? (yes / maybe / no)
9. Photos: did they load fast enough on mobile data? (1-5)
10. Language: any wrong or awkward text? Screenshot if possible.
11. Bugs or crashes: what were you doing?
12. On a scale of 0-10, how likely are you to recommend this to a friend?
13. One thing you would change.

### What to measure (PostHog + TestFlight + Sentry)

| Metric | Target to proceed to launch |
|--------|-----------------------------|
| Testers who played ≥ 5 dailies in 14 days | ≥ 40% |
| D1 retention (daily-challenge players) | ≥ 35% |
| D7 retention | ≥ 20% |
| Share tap rate on daily result | ≥ 25% |
| Median rounds per solo session | ≥ 8 |
| Duel invite → accept within 24 h | ≥ 50% |
| Crash-free sessions | ≥ 99% |
| Median time to first reveal on fresh install | < 60 s |
| Median photo load time on LTE | < 1.5 s for first photo |
| PII / leak reports | 0 unresolved |
| Feedback form responses | ≥ 15 |
| NPS | ≥ 20 |

Below target on retention or share rate: fix, run one more week, do not
launch on a date. Below target on crash-free or PII: hard block.

## Performance testing

| Area | Method | Budget |
|------|--------|--------|
| Cold start to home | Sentry app start metric, 20 launches on iPhone 11 | < 2.0 s |
| Round transition | `expo-image` prefetch of next round's first photo during current round; measure with PostHog `round_ready_ms` | first photo visible < 300 ms after "next" on Wi-Fi, < 1.5 s on LTE |
| Reveal animation | Reanimated on UI thread; check with Xcode Instruments via a Maestro Cloud recording or `expo-dev-client` perf monitor | 60 fps on iPhone 11, no JS-thread work during count-up |
| Payload size | `get_rounds(…,10)` response | < 30 KB |
| DB queries | `explain analyze` on `get_rounds`, `leaderboard`; index `(category, status, checked_at)` used; random selection via `tablesample` or offset trick, not `order by random()` on the full table | < 20 ms at 50k rows |
| Realtime latency | duel round: time from second guess insert to both clients receiving the update | p95 < 1 s within Latvia |
| Scraper | per-category run time, requests, rejects | < 45 min per night total; alert if 0 inserts |
| Battery / data | 10-round session data use via iOS settings | < 15 MB (photos dominate; cap photo width at 1080) |
| Load | k6 script hitting `get_rounds` and `submit_guess` at 50 rps for 5 min against a staging project | p95 < 300 ms, 0 errors; Supabase free tier connection limits observed |
| Memory | 50-round session, Xcode memory gauge via Instruments export | no growth beyond image cache cap (set to 150 MB) |

## Release checklist

Run before every `eas build --profile production`. Copy into the PR
description of the release branch.

Code and data
- [ ] CI green: unit, SQL, integration.
- [ ] Maestro flows green on the latest preview build.
- [ ] `supabase db diff` empty against prod; migrations applied to prod.
- [ ] Scraper ran successfully the last 3 nights; ≥ 1,000 active listings;
      tomorrow's daily set previewed and sane (no leaked price, no PII, no
      duplicate category).
- [ ] Kill switch tested on staging this release.
- [ ] i18n key parity test passes; no `__TODO__` strings in lv/en (ru if
      shipping).
- [ ] Sentry release created with source maps uploaded; version bumped in
      `app.json` (`version`, `ios.buildNumber` auto-increment on).
- [ ] Real AdMob ids and RevenueCat public key in the production EAS env;
      test ids in dev; verified with `eas env:list`.

Store and legal
- [ ] Privacy policy and terms live at the URLs used in-app and in App
      Store Connect; version date updated if changed.
- [ ] Privacy nutrition labels match the data map in 09 (re-check after any
      SDK change).
- [ ] Review notes (14) updated, demo account credentials valid.
- [ ] Screenshots match the current UI.
- [ ] Attribution link visible on every reveal; portal names spelled as
      agreed with lawyer.
- [ ] Account deletion works on the production build.

Ops
- [ ] Sentry alert rule (crash-free < 99%) and scraper zero-rows alert
      pointing to your phone.
- [ ] PostHog dashboards for the 07 metrics exist.
- [ ] Takedown and support inboxes forward correctly; test email sent.
- [ ] Rollback plan: previous build still in TestFlight; EAS Update channel
      `production` ready for a JS hotfix; `eas update --branch production`
      dry-run works.
- [ ] Release notes written in lv and en (what's new).
- [ ] Tag `v1.x.y` pushed; `docs/notes/launch-log.md` entry created.
