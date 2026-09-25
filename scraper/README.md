# Uzmini Cenu — SS.com scraper

Standalone Node 22+ / TypeScript (ESM) package. Implements docs/03-data-pipeline
and docs/12-ss-scraper-spec: `scheduler → fetcher → parser/ss → normaliser →
quality → deduper → writer`, plus `rechecker` for expiry. Everything except
`fetcher` and `writer` is pure and tested offline against saved pages.

```
src/
  config.ts       crawl plan (districts, makes, random sub-categories), politeness, UA
  fetcher.ts      the ONLY network module: serial + jitter, timeout, retry table, block detection, 7-day disk cache
  parser/ss.ts    parseList / parseDetail → raw strings
  normaliser.ts   parsePrice, parseM2, parseFloor, parseYear, parseKm, parseEngine, region/district, cars, sanitiser
  districts.ts    50 Riga districts: slug ↔ lv ↔ ru
  quality.ts      thresholds, required attrs, photo minimums, deal = sell, leak checks → reject codes
  deduper.ts      URL / photo-id fingerprint / attribute fingerprint (pHash slot marked TODO)
  writer.ts       Supabase service-role upserts into `listings`, `scrape_runs`
  rechecker.ts    expiry rechecks
  scheduler.ts    one night's job queue, budget, ordering
  index.ts        CLI
test/             vitest + fixtures/ (real pages, local only — see .gitignore)
```

## Environment

| Var | Required | Purpose |
|-----|----------|---------|
| `SUPABASE_URL` | for `run`/`recheck`/`stats` without `--dry-run` | project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | same | service-role key; **never** ship to the app |
| `SCRAPER_MAILTO` | always for network commands | contact address in the UA `UzminiCenuBot/1.0 (+mailto:…)` (docs/09) |
| `SCRAPER_CACHE_DIR` | no | raw HTML cache dir, default `.cache/html` (7-day TTL) |
| `SCRAPER_LIMIT` | no | dev cap on detail fetches (same as `--limit`) |

PowerShell: `$env:SCRAPER_MAILTO = "you@example.lv"`. Bash: `export SCRAPER_MAILTO=…`.

## Commands

```bash
cd scraper
npm install
npm test                                   # vitest, offline, fixtures only
npm run typecheck                          # tsc --noEmit

npm run scrape -- run --dry-run --limit 20             # parse + print JSON lines, no DB
npm run scrape -- run --category flats,cars            # full night for two categories
npm run scrape -- run --no-recheck                     # skip expiry rechecks
npm run scrape -- recheck [--limit 600] [--dry-run]    # only expiry rechecks (oldest checked_at first)
npm run scrape -- stats                                # active pool per category + last 10 scrape_runs
npm run scrape -- parse test/fixtures/cars/detail-touran-cdegbp.html --category cars --url https://www.ss.com/msg/lv/transport/cars/volkswagen/touran/cdegbp.html
npm run scrape -- parse test/fixtures/flats/list-purvciems.html --list
```

`--dry-run` makes no network-free promise: it still fetches SS pages (with the
same politeness) but writes nothing to Supabase and prints each parsed listing
with its quality verdict as one JSON line on stdout. `parse` is fully offline.

Exit code 2 = the run hit a block signal and stopped.

## What a night does (docs/03 "Order of work")

1. Refuse to start if the last `scrape_runs.blocked_until` is in the future.
2. Recheck tomorrow's `daily_sets` candidates (they must be verified active).
3. List pages, round-robin across ≈ 60 list URLs (20 Riga districts × 3 pages,
   6 other flat regions, 3 house regions × 5, 25 car makes × 2, 8 random
   sub-categories × 3 ≈ 170 requests). Rent/buy/exchange/no-price rows are
   dropped at this stage by URL and price text and never cost a detail fetch.
4. Detail pages for rows not already in `listings` (≤ 1,800; `--limit` caps it).
   Known rows only get `checked_at` bumped.
5. normalise → quality → dedupe → upsert by `source_url`. Rejects are written
   with `status = 'rejected'` and the reason in `attributes.reject`.
6. Remaining rechecks with whatever budget is left (≤ 600).
7. One `scrape_runs` row per run: `requests, new_rows, updated_rows,
   expired_rows, rejected {code: n}, errors, blocked_until, notes`.

A list page that parses to 0 rows is retried once, then logged as
`parser_zero_rows` and its deeper pages skipped. Slugs in `config.ts` marked
`(infer)` have not been observed live yet; the first real run's zero-row list
tells you which to fix.

## Safety rules (docs/09, docs/12)

- **One IP, one worker, strictly serial**, 2.5 s ± 0.5 s between requests,
  hard budget 3,000 requests/night, 15 s timeout.
- **Only** `https://www.ss.com/lv/...` browse-tree URLs and `/msg/lv/...`
  detail pages. Never `/en/`, `/ru/`, `/photo/`, `*_f/` region filters,
  `fDg…html` encoded filters, `/search/`, currency paths. `isAllowedUrl`
  enforces this before every request.
- Desktop/bot UA only; a phone UA is redirected to `m.ss.com` (different HTML).
  Such a redirect is treated as a block.
- **Block = stop.** 403 / 429 / small 503, captcha words, or a redirect out of
  the path family throws `BlockedError`; the run ends, `blocked_until = now + 24 h`
  is written to `scrape_runs`, nothing is retried, the IP is never changed.
  If the next night is also blocked, stop scheduling and re-enable by hand.
- Retries only for network errors / 5xx / timeouts: 10 s, 60 s, 300 s.
- Never click "Parādīt tālruni" / VIN / plate; never store `Iela`, description,
  phone, e-mail, `Kadastra numurs`, `Adrese`, `Darbalaiks`, `WWW`. The
  normaliser drops them; tests assert they are absent.
- Photos are hotlinked URLs on `i.ss.com` and are never downloaded here.
- `test/fixtures/` are real third-party ad pages: local only, never publish.

## Scheduling

**Windows Task Scheduler (dev machine / VPS):**

```powershell
# runs 01:10 Europe/Riga nightly; adjust the path
$action  = New-ScheduledTaskAction -Execute "powershell.exe" -Argument '-NoProfile -Command "cd ''D:\VM Linux 2\PROJECTS\uzmini-cenu\scraper''; $env:SCRAPER_MAILTO=''you@example.lv''; $env:SUPABASE_URL=''https://xxx.supabase.co''; $env:SUPABASE_SERVICE_ROLE_KEY=''…''; npm run scrape -- run *>> logs\scrape.log"'
$trigger = New-ScheduledTaskTrigger -Daily -At 01:10
Register-ScheduledTask -TaskName "UzminiCenu scrape" -Action $action -Trigger $trigger -RunLevel Limited
```

Keep the machine awake (or use a VPS). Put secrets in the task's environment
or a `.env` loaded by your shell, not in the command line, when moving past dev.

**Fly.io / any Linux VPS:** the package is a plain `node` process with no
native deps. A `fly.toml` with a scheduled machine
(`fly machine run … --schedule daily`) or a `cron` line
`10 1 * * * cd /app/scraper && npm run scrape -- run >> /var/log/scrape.log 2>&1`
is enough; set the three env vars as Fly secrets. The Supabase Edge Function
variant (`supabase/functions/scrape-ss`) can import the same modules if the
50 s limit is respected by passing `--limit`, but the VPS/`node` path is the
recommended one (docs/03).

## Deviations from docs worth knowing

- Price thresholds follow the scraper brief (flats 5k–2M, houses 10k–3M,
  land 1k–1M, cars 300–200k, random 1–20k), wider than docs/03's first draft.
  Change `THRESHOLDS` in `quality.ts` once volumes are known.
- Photo dedupe uses the i.ss.com numeric photo id of the first photo
  (`listings.photo_hash = 'ssid:77430610'`), not a perceptual hash. A real
  pHash slot is marked in `deduper.ts`.
- `random` rows need a `title_hint` (docs/03); if the sanitiser strips the
  whole title (price-only titles) the row is rejected `missing_attr`.
