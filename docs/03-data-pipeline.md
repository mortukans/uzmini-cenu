# 03 Data pipeline

## Principle

Store the minimum: price, category, attributes, location, source URL, and
photo URLs. Do **not** copy photos to our storage in v1 (see 09-legal-risks).
Photos are loaded by the client directly from the portal's CDN. If the portal
blocks hotlinking, fall back to a short-lived proxy cache, and re-open the
legal question.

Everything below writes into the `listings` table from 05-data-model and
reads back into `daily_sets`. No other tables are introduced by the pipeline
except the small operational ones listed in "Monitoring".

## Sources

| Source | Categories | Method | Notes |
|--------|-----------|--------|-------|
| SS.com | all | HTML scraping, list pages + detail pages | dominant, must have. Stable old-school HTML. Spec: 12-ss-scraper-spec |
| City24.lv | flats, houses | JS app; internal JSON endpoints | owned by Baltic Classifieds Group; cleaner photos. See 12, section "City24" |
| PP.lv, Reklama.lv, MM.lv | general | later | backup sources |
| Andelemandele.lv | secondhand items | later | good for "random" |
| Kadastrs / Zemesgrāmata sales data | actual sale prices | open data / paid dataset | numbers-only mode, no photos, fully legal |

The Phase 0 probe ran on 2026-09-25 (`docs/notes/ss-probe.md`): no
blocking down to 2 req/s, photos hotlink freely with 14-day cache headers,
all selectors confirmed. The numbers below were kept deliberately more
polite than the site requires. Still open: expiry behaviour (day 2/4
recheck), RSS feeds, logged-in delta.

## Scraper architecture

One Node/TypeScript package `scraper/` shared between the Edge Function
(cron) and a plain `node` entry point for a VPS. Pure functions everywhere
except `fetcher` and `writer`, so parsers are testable offline.

```
 scheduler ─▶ fetcher ─▶ parser(source) ─▶ normaliser ─▶ quality ─▶ deduper ─▶ writer
     │           │                                                        │
     │           └── raw HTML cache (7 d, disk / Supabase Storage)         └─▶ listings
     └─▶ rechecker (expiry) ─▶ writer                                      └─▶ scrape_runs
```

| Module | Responsibility | Input → Output |
|--------|----------------|----------------|
| `scheduler` | decides which (source, category, region, page) jobs run tonight, in what order, and holds the global token bucket | config → job queue |
| `fetcher` | HTTP GET with politeness, retries, block detection, raw HTML caching; the **only** module allowed to do network | URL → `{status, html, fetchedAt, elapsedMs}` |
| `parser/ss`, `parser/city24` | source-specific HTML/JSON → `RawListing` (strings exactly as found, no interpretation) | html → `RawListing[]` (list) or `RawListing` (detail) |
| `normaliser` | Latvian/Russian strings → typed values: price int, m2 float, year int, canonical district, canonical make/model; sets `category`, `region`, `location`, `attributes` | `RawListing` → `Listing` |
| `quality` | applies category thresholds, deal-type rules, photo rules, leak rules; returns accept or a reject reason code | `Listing` → `{ok} \| {reject: code}` |
| `deduper` | photo pHash + attribute fingerprint against active rows | `Listing` → `{new} \| {dup_of: id}` |
| `writer` | upsert by `source_url`, bump `checked_at`, set `status`, record run stats | `Listing[]` → DB |
| `rechecker` | re-fetches active listings with `checked_at` older than 3 d, marks `expired` on 404 / "sludinājums nav atrasts" | DB → DB |
| `daily-builder` | separate job at 03:00, see "Daily set builder" | DB → `daily_sets` |

Each `RawListing` keeps `raw: Record<string,string>` (label → value as
scraped) inside `attributes._raw` for the first 30 days so parser bugs can be
fixed by re-normalising without re-fetching. Dropped by the retention job.

## Scheduling and rate limits

Single IP, single worker, strictly serial requests. Numbers are the starting
point and are adjusted after the Phase 0 probe.

| Parameter | Value |
|-----------|-------|
| Request interval | 2.5 s ± 0.5 s jitter (≈ 24 req/min, max 1,400 req/h) |
| Nightly window | 01:00-05:00 Europe/Riga |
| Daily request budget | 3,000 (hard stop) |
| List pages per (category, region) per night | flats Riga: 3 pages per district for the 20 largest districts; flats other: 5; houses: 10; cars: 2 pages per make for the 25 most common makes; random: 3 per sub-category |
| Detail fetches per night | ≤ 1,800 (only rows that pass list-level filters and are not already in `listings`) |
| Recheck fetches per night | ≤ 600, oldest `checked_at` first |
| Target fresh listings / category / day | 200-400 |
| Target active pool | flats 1,500 · houses 400 · cars 1,500 · random 600 |

Order of work each night: rechecks of listings in tomorrow's daily set
candidates first (they must be verified active), then new list pages, then
detail pages, then remaining rechecks. If the budget runs out, rechecks are
what gets cut, never the daily-set verification.

Cron: Supabase `pg_cron` calls the Edge Function every 10 minutes between
01:00 and 05:00; each invocation processes as many jobs as fit in ~50 s and
persists the queue position in `scrape_runs`. If Edge Function limits bite,
the same package runs as one `node scraper run` process on Fly.io.

## Retry and backoff

| Condition | Action |
|-----------|--------|
| Network error, 5xx, timeout (15 s) | retry up to 3 times: 10 s, 60 s, 300 s |
| 404 on detail page | no retry; mark `expired` if it was ours, else skip |
| 429, 403, or captcha/blocking heuristic hit | **stop the whole run**, set `blocked_until = now() + 24 h` in `scrape_runs`, alert. No retries, no IP change (09-legal-risks) |
| Parser returns 0 rows on a list page that previously had rows | retry once after 60 s; then raise `parser_zero_rows` alert and skip that job |
| Second consecutive night blocked | stop scheduling; manual re-enable only |

## Blocking detection heuristics

Any of these on a response counts as "blocked" for the table above:

1. HTTP 403 / 429 / 503 with an HTML body under 5 kB.
2. Body contains `captcha`, `g-recaptcha`, `cf-challenge`, `Access denied`,
   `Jūs esat bloķēts`, `too many requests` (case-insensitive).
3. Redirect to a URL outside the requested path family (e.g. list page
   redirects to `/lv/` root).
4. A list page whose HTML lacks the expected structural anchor (for SS: no
   row link matching `/msg/lv/`), three times in a row.
5. Median response time over the last 20 requests > 4x the run's first 20.
6. Photo CDN probe (HEAD on one `.800.jpg` with our real `Referer`) returns
   403 → not a block of the scraper, but raise `hotlink_blocked` alert.

## Monitoring and alerting

Operational tables (add to 05 when Phase 1 starts):

```sql
create table scrape_runs (
  id            bigserial primary key,
  source        text not null,
  started_at    timestamptz default now(),
  finished_at   timestamptz,
  requests      int default 0,
  new_rows      int default 0,
  updated_rows  int default 0,
  expired_rows  int default 0,
  rejected      jsonb default '{}',    -- {reason_code: count}
  errors        int default 0,
  blocked_until timestamptz,
  notes         text
);
```

Metrics and thresholds (checked by a `pg_cron` query at 06:00, alert via
email to the dev + PostHog event; later Telegram):

| Metric | Warn | Critical |
|--------|------|----------|
| `new_rows` per source per night | < 100 | 0 (see 09 risk register) |
| Active pool per category | below 70% of target | below 40% |
| Reject rate per reason | any single reason > 40% of candidates | any > 70% (usually a parser regression) |
| Parser field coverage (share of detail pages with `price`, `m2`/`year`, ≥ 2 photos) | < 90% | < 70% |
| HTTP error rate in run | > 5% | > 15% |
| `blocked_until` set | always alert | |
| Median fetch time | > 3 s | > 8 s |
| Listings expiring within 24 h that are in tomorrow's `daily_sets` | any | |
| Hotlink probe fails | always alert | |

Every alert links to the run row. Runbook: check `rejected` breakdown first,
then compare the cached raw HTML of a failing page against the fixtures.

## Data retention

| Data | Keep | Then |
|------|------|------|
| `listings.status = active` | while active | rechecked every 3 d |
| `listings.status = expired` | 90 d | delete row unless referenced by `daily_sets`, `duels`, `rooms`, or `guesses` (then keep, the snapshot is what the game shows) |
| `listings.status = rejected` | 14 d (for debugging filters) | delete |
| `attributes._raw` | 30 d | strip key |
| Raw HTML cache | 7 d | delete |
| `scrape_runs` | 180 d | delete |
| Photo URLs | as long as the row | never copied (v1) |

Personal data (phone, name, email) is never written; the sanitiser runs
inside `normaliser`, before `writer`.

## Quality filters

Reject codes are short snake_case strings written to `scrape_runs.rejected`
and to `listings.status = rejected` rows for 14 days.

### Category thresholds (EUR, asking price)

| Category | Min | Max | Required attributes | Photo min | Reject codes |
|----------|-----|-----|--------------------|-----------|--------------|
| flats | 15,000 | 1,500,000 | `rooms`, `m2`, `district` or `town`, `floor` | 2 | `price_low`, `price_high`, `missing_attr`, `few_photos` |
| houses | 20,000 | 3,000,000 | `m2`, `town`; `land_m2` optional | 2 | same |
| cars | 300 | 250,000 | `make`, `model`, `year`, `engine` or `fuel`; `km` optional but recommended | 2 | same + `no_year` |
| land | 1,000 | 2,000,000 | `area_ha` or `m2`, `town` | 1 | same |
| random | 5 | 20,000 | `title_hint`, `subcategory` | 1 | same |

Sanity ranges, beyond price: flats `m2` 12-400, `rooms` 1-9; houses `m2`
30-1,500; cars `year` 1950-current+1, `km` 0-1,000,000; price per m2 for
flats 300-8,000 €/m2 (outside → `ppm2_outlier`, usually a mis-filed rent or
a typo).

### Deal type

Only `sell`. Rent (`€/mēn.`, `hand_over`, `rent`), buy requests (`pērku`,
`buy`), exchange (`change`, `maiņa`) and "other" are dropped at the list
stage by URL and by price-text pattern, so they never cost a detail fetch.
Codes: `deal_rent`, `deal_buy`, `deal_change`, `deal_other`.

### Price text

Reject `price_missing` if price text is empty, `pēc vienošanās`,
`vienojoties`, `договорная`, or `0 €`. Reject `price_not_eur` if a currency
other than € appears.

### Photos

- `few_photos`: fewer than the category minimum.
- `stock_photo`: pHash Hamming distance ≤ 6 to any hash in `photo_blocklist`
  (seeded manually with agency logos, "foto drīzumā" placeholders, map
  screenshots). Later, a cheap vision model.
- `photo_unreachable`: first photo HEAD is not 200 (checked for daily-set
  candidates only, to save requests).

### Leak prevention

- `title_leak`: `title_hint` still contains a number ≥ 3 digits followed by
  `€`, `eur`, `Ls`, `k`, `tūkst` after scrubbing; then drop the hint, not the
  listing.
- Attributes shown never include street (flats/houses) or plate/VIN (cars).
- Description is never stored.

### `random` category extras

Allowlisted SS sub-categories only (furniture, electronics, collectibles,
sports, musical instruments, home appliances, toys). Explicitly excluded:
jobs, services, dating, animals, weapons, medical, tobacco/alcohol, anything
in the "erotika" tree. Titles are checked against a small profanity /
adult-word list (lv + ru). Code: `random_excluded`.

## Normalisation rules

### Price

`"68 000 € (1 360 €/m²)"` → take the first number group before `€`; remove
spaces, NBSP (` `), thin spaces, dots and commas used as thousands
separators. Result must be an integer. `ppm2` is recomputed by us, not
parsed.

### Area (m2)

`"50 m²"`, `"50.5 m2"`, `"50,5 kv.m"` → float, comma → dot. For houses SS
shows both `Platība` (house) and `Zemes platība` (land) which may be in
`m²` or `ha`; store `m2` and `land_m2` (ha × 10,000). Land category: store
`area_ha` if ≥ 1 ha else `m2`.

### Floor

`"5/5"` → `floor: 5, floors_total: 5`. `"1/9 (lifts)"` → strip parenthetical,
set `elevator: true`. Ground floor variants `"0"`, `"pagr."`, `"cok."` →
`floor: 0`.

### Year (cars)

`"2007 marts"`, `"2007 g."`, `"2007"` → `year: 2007`. Reject `no_year` if
no 4-digit number 1950..current+1.

### Mileage

List: `"345 tūkst."` → 345,000. Detail: `"345 000"` under label
`Nobraukums, km` → 345,000. `"тыс."` same as `tūkst.`. Missing or `"-"` →
omit key.

### Engine

`"3.0 dīzelis"` → `engine_l: 3.0, fuel: 'diesel'`. Map: `benzīns`/`бензин`
→ petrol, `dīzelis` → diesel, `gāze/benzīns` → lpg, `hibrīds` → hybrid,
`elektro`/`E` → electric (no `engine_l`, keep `power_kw` if present).
Gearbox: `Automāts` → `auto`, `Manuāla` → `manual`.

### Car make / model canonicalisation

- Make: from the URL segment (`/cars/mercedes/`) mapped through a fixed
  table: `mercedes` → "Mercedes-Benz", `vaz` → "VAZ (Lada)", `gaz` → "GAZ",
  `land-rover` → "Land Rover", everything else Title Case. Never from free
  text.
- Model: from the URL segment when present (`/audi/q7/`), else from the list
  `Modelis` column. Normalise: upper-case letter+digit codes (`a4`, `q7`,
  `e-tron` → `A4`, `Q7`, `e-tron` via exception list), strip trims
  (`S-line`, `Quattro`, `AMG`, `TDI`, `4Matic`) into `attributes.trim_hint`
  which is **not** shown.
- Unknown make (`/others/`) → reject `unknown_make`.

### Riga district canonicalisation

Canonical key is the SS URL slug; the app shows `lv` and `ru`. Slugs are
what appear under `/lv/real-estate/flats/riga/`:

| slug | lv | ru | slug | lv | ru |
|------|----|----|------|----|----|
| centre | Centrs | Центр | kengarags | Ķengarags | Кенгарагс |
| vecriga | Vecrīga | Старая Рига | plyavnieki | Pļavnieki | Плявниеки |
| agenskalns | Āgenskalns | Агенскалнс | purvciems | Purvciems | Пурвциемс |
| aplokciems | Aplokciems | Аплокциемс | mezhciems | Mežciems | Межциемс |
| bergi | Berģi | Берги | mezhapark | Mežaparks | Межапарк |
| biekensala | Bieķēnsala | Биекенсала | teika | Teika | Тейка |
| bierini | Bieriņi | Биерини | vef | VEF | ВЭФ |
| bolderaya | Bolderāja | Болдерая | yugla | Jugla | Югла |
| breksi | Brekši | Брекши | jaunciems | Jaunciems | Яунциемс |
| bukulti | Bukulti | Букулты | jaunmilgravis | Jaunmīlgrāvis | Яунмилгравис |
| chiekurkalns | Čiekurkalns | Чиекуркалнс | vecmilgravis | Vecmīlgrāvis | Вецмилгравис |
| darzciems | Dārzciems | Дарзциемс | mangali | Mangaļi | Мангали |
| daugavgriva | Daugavgrīva | Даугавгрива | mangalsala | Mangaļsala | Мангальсала |
| dreilini | Dreiliņi | Дрейлини | vecaki | Vecāķi | Вецаки |
| dzeguzhkalns | Dzegužkalns (Dzirciems) | Дзегужкалнс (Дзирциемс) | vecdaugava | Vecdaugava | Вецдаугава |
| grizinkalns | Grīziņkalns | Гризинькалнс | sarkandaugava | Sarkandaugava | Саркандаугава |
| ilguciems | Iļģuciems | Ильгюциемс | kundzinsala | Kundziņsala | Кундзиньсала |
| imanta | Imanta | Иманта | maskavas-priekshpilseta | Latgales priekšpilsēta (Maskačka) | Латгальское предместье (Маскачка) |
| zolitude | Zolitūde | Золитуде | krasta-st-area | Krasta rajons | Район ул. Краста |
| janjavarti | Jāņavārti | Яняварты | shkirotava | Šķirotava | Шкиротава |
| katlakalns | Katlakalns | Катлакалнс | zasulauks | Zasulauks | Засулаукс |
| kipsala | Ķīpsala | Кипсала | shampeteris-pleskodale | Šampēteris-Pleskodāle | Шампетерис-Плескодале |
| kleisti | Kleisti | Клейсты | tornjakalns | Torņakalns | Торнякалнс |
| kliversala | Klīversala | Кливерсала | ziepniekkalns | Ziepniekkalns | Зиепниеккалнс |
| lucavsala | Lucavsala | Луцавсала | zakusala | Zaķusala | Закюсала |
| other | Cits rajons | Другой район | | | |

Rule: `location` = canonical `lv` name; `attributes.district` = slug;
`region = 'riga'`. Towns outside Riga: `location` = town name from the SS
region tree (`Jūrmala`, `Ogre`, ...), `region = 'riga_region'` for the SS
"Rīgas rajons" and Jūrmala trees, else `'latvia'`. Listings filed under
`other` keep `region` but get `location = 'Rīga'`.

### Series (flats)

Keep SS value verbatim in `attributes.series` (`LT proj.`, `602.`, `103.`,
`119.`, `467.`, `Hrušč.`, `Jaun.`, `Renov.`, `Specpr.`, `P. kara`,
`Staļina`, `Čehu pr.`, `M. ģim.`, `Priv. m.`), and map to a display label
per language in the app, not in the pipeline.

### Sanitiser (applies to `title_hint` and `location` only)

Regex removal of: `(\+?371)?[\s-]?\d{2}[\s-]?\d{3}[\s-]?\d{3}` (phones),
emails, `@handles`, capitalised two-word names followed by a phone,
`SIA "..."`, and any `\d[\d\s]{2,}\s?(€|eur|ls|k|tūkst)`. Result truncated to
80 chars at a word boundary.

## Duplicate detection

Goal: never show the same flat twice in a session or the same car under two
agencies. Run in `deduper` against `status = active` rows of the same
`category`.

1. **Exact:** same `source_url` → update, not insert (writer upsert).
2. **Photo:** pHash (64-bit DCT) of the first photo, stored in
   `listings.photo_hash`. Hamming distance ≤ 8 against active rows of the
   same category → `dup_photo`. Index: store the 4 16-bit bands in a jsonb
   and pre-filter on band equality (BK-tree is overkill at 5k rows; a full
   scan of 5k hashes in SQL is < 50 ms).
3. **Attribute fingerprint:**
   - flats: `(district, rooms, round(m2), floor, floors_total)` and price
     within 3%;
   - houses: `(town, round(m2/10), round(land_m2/100))` and price within 3%;
   - cars: `(make, model, year, fuel, round(km/5000))` and price within 2%;
   - random: normalised `title_hint` trigram similarity > 0.8 and price equal.
   Match → `dup_attrs`.
4. Cross-source (SS vs City24): same rule set; keep the row with more photos,
   record the other's URL in `attributes.also_at`.

The duplicate row is written with `status = rejected`, reason `dup_*`, and
`attributes.dup_of = <id>`, so curation can inspect false positives.

## Daily set builder

Runs at 03:00 Europe/Riga for **tomorrow**, so the set can be previewed all
day and swapped in Supabase Studio.

```
function buildDaily(day, secret):
  seed = sha256(day + secret)
  rng  = seededRandom(seed)

  quotas = [flats, flats, houses, cars, random]
  chosen = []

  for cat in quotas:
    pool = select from listings
           where category = cat
             and status = 'active'
             and first_seen_at < now() - 24h          -- stable
             and checked_at    > now() - 48h          -- verified recently
             and quality >= 0                         -- not flagged
             and id not in (any daily_sets.listing_ids of last 60 days)
             and photo_urls[1] passed HEAD probe today
    if cat == 'flats' and chosen has a flat:
         pool = pool where attributes.district != chosen_flat.district
    if pool.size < 20: alert('daily_pool_thin', cat); relax first_seen to 12h
    # avoid trivially easy or absurd items
    pool = pool where price between p10(cat) and p95(cat)
    # prefer curated
    weights = pool.map(l => 1 + max(l.quality, 0) * 2)
    pick = weightedChoice(pool, weights, rng)
    chosen.push(pick)

  chosen = shuffle(chosen, rng)                       -- category order varies
  snapshot = chosen.map(l => { id, category, location, attributes (shown
                               keys only), photo_urls, price_eur, source_url })
  upsert daily_sets(day, listing_ids = chosen.ids, snapshot)
  recheck(chosen)                                     -- one detail fetch each,
                                                      -- ensure still active
```

Notes:
- If a chosen listing expires before the day starts, `snapshot` still holds
  the price and photos; the game shows it anyway and the "open listing"
  button says "sludinājums vairs nav aktīvs".
- `secret` lives in Supabase Vault; changing it changes future days only.
- p10/p95 per category are computed nightly over the active pool.
- Manual swap: update `daily_sets.listing_ids[i]` and re-run
  `snapshotDaily(day)`; the function is idempotent.

## Testing strategy for parsers

- `scraper/fixtures/{source}/{category}/{name}.html`: real pages saved from
  the probe, one list page and three detail pages per category (typical,
  minimal-attributes, edge case such as bilingual or missing mileage).
  Personal data is scrubbed by hand before committing (phones already masked
  on SS, but check descriptions).
- Golden JSON next to each fixture: `name.expected.json` with the
  `RawListing`/`Listing` output. Tests are `parse(fixture) deep-equals
  expected`.
- Property tests for `normaliser` functions (`parsePrice`, `parseM2`,
  `parseFloor`, `parseYear`, `parseKm`) with tables of Latvian/Russian
  inputs.
- A weekly **drift test** (CI cron, not a unit test) fetches exactly one live
  list page and one detail page per category with the same politeness
  settings, and fails if field coverage drops below 90% vs the golden
  schema. This is the early warning for HTML changes.
- Quality filter tests: each reject code has at least one fixture that
  triggers it and one that does not.
- Dedupe tests: pairs of fixtures known to be the same object (same flat
  listed by two agencies, found during the probe).

## Curation workflow

Supabase Studio plus three SQL views; a tiny internal screen in the app
(hidden behind a dev flag) in Phase 2 if Studio gets tedious.

| Task | How |
|------|-----|
| Flag a bad listing | `update listings set quality = -1, status = 'rejected' where id = ?` (excluded from all modes) |
| Mark as funny / featured | `quality = 3` (weight ×7 in daily builder, tag shown in `random`) |
| Preview tomorrow's set | view `v_daily_preview` joins `daily_sets` (day = tomorrow) with listings and renders photo URLs |
| Swap an item | edit `listing_ids`, call `select snapshot_daily(current_date + 1)` |
| Review rejects | view `v_rejects_today` groups rejected by reason with sample URLs; fix filters, then `select reprocess_raw(id)` which re-runs normaliser + quality on `attributes._raw` |
| Add stock photo to blocklist | insert pHash into `photo_blocklist` |
| Takedown request | `update listings set status = 'rejected', quality = -9 where source_url = ?`; per-source kill switch from 09 |

Weekly 15-minute routine: look at `scrape_runs` for the week, skim 20 random
active listings per category, check the `random` category for anything
embarrassing, glance at next 3 days of daily sets.

## Volume estimate

5 categories x 300 listings/day x 30 days ≈ 45k rows/month, a few MB, plus
~3k requests/night. Free Supabase tier is fine for a long time; raw HTML
cache (≈ 60 kB x 3k x 7 d ≈ 1.3 GB) should live on the VPS disk or Storage,
not in Postgres.
