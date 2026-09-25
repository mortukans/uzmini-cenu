# 12 SS.com scraper spec

Observed on 2026-09-25 from 7 page fetches, then **confirmed by the Phase 0
probe the same day** (`tools/probe`, ~330 requests, 8 list pages, 30 detail
pages; results in `notes/ss-probe.md`). Items previously marked **verify**
are now stated as fact and tagged **(probe)**.

## robots.txt findings

- No `Crawl-delay`. `Sitemap: https://www.ss.com/sitemap.xml`.
- **Allowed** for `User-agent: *`: `/lv/real-estate/...`, `/lv/transport/...`,
  `/msg/...` (detail pages), `/lv/*/rss/`. Nothing we need is disallowed.
- **Disallowed** and relevant to us:
  - `/en/` — the whole English site. Scrape `/lv/` only (RU also allowed,
    not needed).
  - `/photo/`, `/*/photo/`, `/nophoto/` — the photo-gallery *page* views and
    the "only with photo" filter. The CDN `i.ss.com` is a different host and
    is not covered by this file (it has its own; probe should fetch
    `https://i.ss.com/robots.txt`).
  - `/eur/`, `/ls/`, `/*/eur/` — currency-switch paths.
  - `/*/riga_f/`, `/*/riga_region_f/`, `/*/jurmala_f/`, ..., `/*/estonia_f/` —
    region **filter** pages. Do not use `_f` URLs; use the plain region tree.
  - `/*/fDgSeF4*.html` and similar — encoded search/filter/map result pages.
    Do not construct filter URLs; stick to category/region/deal/page URLs.
  - `/c/`, `/go/`, `/frame/`, `/inbox/`, `/*/abuse/`, `/*/contacts/`,
    `/w_inc/` — irrelevant.
- Conclusion: the plain browse tree is not disallowed, and there is no rate
  directive. Our self-imposed 2.5 s interval stands.

## URL structure

```
https://www.ss.com/{lang}/{cat}/{sub}/{region}/{district?}/{deal}/{page}
```

| Part | Values | Notes |
|------|--------|-------|
| `lang` | `lv` (use), `ru` | `/en/` is robots-disallowed |
| `cat/sub` | `real-estate/flats`, `real-estate/homes-summer-residences`, `real-estate/plots-and-lands`, `transport/cars`, misc trees under `/lv/...` | houses slug **verify**; SS uses `homes-summer-residences` |
| `region` | `riga`, `riga-region`, `jurmala`, `liepaja`, `daugavpils`, ... , `all` | `/lv/real-estate/flats/riga/all/` = all districts |
| `district` | Riga: 50 slugs, see canonical table in 03 (`centre`, `purvciems`, `plyavnieki`, `yugla`, `bolderaya`, `mezhapark`, `maskavas-priekshpilseta`, `krasta-st-area`, `other`) | slugs are SS's own transliterations, not Latvian |
| `deal` | `sell`, `buy`, `hand_over` (izīrē), `rent` (īrē), `change` (maina) | cars: `sell`, `buy`, `change`, `rent` (iznomā), `other` (dažādi). Observed: `/lv/transport/cars/audi/sell/`, `/lv/transport/cars/exchange/`. Exact flat rent/buy slugs **verify** |
| `page` | `` (page 1), `page2.html`, `page3.html` ... | also `page1.html` exists |
| RSS | `/lv/real-estate/flats/riga/rss/` | per category/region; **candidate cheap change feed**, probe it |

Cars add a model level: `/lv/transport/cars/audi/a4/sell/`. Special virtual
lists exist (`exclusive-cars`, `electric-cars`, `retro-cars`, `sport-cars`,
`tuned-cars`) — ignore, they duplicate make lists.

Detail pages:

```
https://www.ss.com/msg/{lang}/{cat}/{sub}/{region}/{district}/{id}.html
https://www.ss.com/msg/lv/transport/cars/{make}/{model}/{id}.html
```

`id` is **5-6 lowercase letters**, not a number: observed `aemdn`, `hddnp`,
`ainxg`, `hxnxd`, `hhekx` (flats) and `cbhgni`, `cgnggi`, `cgxckm`, `okkod`,
`fckek` (cars). Store `source_url` exactly as the canonical `/msg/lv/...`
URL with the path echoed by the list page. The numeric photo id
(`77430610`) is a different sequence and must not be treated as the ad id.

## List page structure

Observed: 33 rows on Purvciems sell page 1, 6 pages total (≈ 180-200
active sell ads in one large district). Audi sell: 9+ pages.

Flats columns (header text verbatim):

| # | Header | Example | Notes |
|---|--------|---------|-------|
| 0 | (thumbnail) | `https://i.ss.com/gallery/8/1549/387154/77430610.th2.jpg` | `.th2.jpg` list thumb |
| 1 | `Sludinājumi` | "Pārdodam 2-istabu dzīvokli ērtā lokācijā. Nav stūra..." | truncated ~60 chars; often Russian; link to detail |
| 2 | `datums` | | sortable |
| 3 | `Iela` | `Dzelzavas 95`, `Staiceles 1 k 3`, `Zvaigznāja g. 14` | street + house number: **never store** |
| 4 | `Ist.` | `2` | rooms |
| 5 | `m²` | `50` | integer on list, may be decimal on detail |
| 6 | `Stāvs` | `5/5`, `1/9` | floor/total |
| 7 | `Sērija` | `LT proj.`, `602.`, `Jaun.` | |
| 8 | `Cena, m2` | `1 360 €` | ignore, recompute |
| 9 | `Cena` | `68 000 €` | |

Cars columns:

| # | Header | Example |
|---|--------|---------|
| 0 | (thumbnail) | `...387157/77431329.th2.jpg` |
| 1 | `Sludinājumi` | "Pārdodu Audi Q7 ar 3.0 Tdi dīzeļdzinēju un automātisko..." |
| 2 | `Datums` | |
| 3 | `Modelis` | `Q7`, `E-tron`, `100` |
| 4 | `Gads` | `2007` |
| 5 | `Tilpums` | `3.0D`, `2.0D`, `2.3`, `E` (electric) |
| 6 | `Nobraukums` | `345 tūkst.`, `-` when missing |
| 7 | `Cena` | `4 700 €` |

Row markup **(probe)**: `<tr id="tr_58114044">` (numeric id, a third
sequence unrelated to the ad id or photo id), thumbnail cell
`<td class="msga2">`, title link `<a class="am" id="dm_58114044"
href="/msg/lv/...">` inside `<td class="msg2">`, data cells
`<td class="msga2-o pp6">` (cars also `msga2-r`). Exactly **30 ad rows per
page**; the table is nested inside wrapper rows, so select rows via the
`/msg/lv/` link's closest `<tr>`, not every `<tr>`. No promoted-row class
was seen on the sampled pages.

**List-page prices use a comma as thousands separator** (`68,000 €`,
`1,360 €`) while detail pages use a space (`68 000 €`). `parsePrice` strips
both. Car list mileage is abbreviated (`175 tūkst.`); detail has the full
number (`218 400`).

Ordering is newest first by default; the observed top rows both had
`Datums: 25.09.2026 11:0x`, i.e. list pages show ads within minutes of
posting. Pagination is stable enough for a nightly crawl of the first N
pages.

## Detail page structure

Attributes are a two-column table `<td class="ads_opt_name">` /
`<td class="ads_opt">` **(probe)**, price in `<td class="ads_price">`
**(probe)**, photos in the gallery block (`.ads_photo_label` present),
description in `<div id="msg_div_msg">` **(probe)**. Labels carry a
trailing colon in the HTML (`Pilsēta:`); strip it. Present on **every**
category **(probe)**: `Vieta` (location: `Rīga`, `Rīgas rajons`,
`Talsi un raj.`) — use it for `region`, never the URL. Dealer ads add
`Uzņēmums`, `Adrese`, `Darbalaiks`, `WWW` (not stored; `Uzņēmums` may be
kept as `attributes.dealer = true`).

Flat detail, observed verbatim:

| Label | Value |
|-------|-------|
| `Pilsēta` | `Rīga` |
| `Rajons` | `Purvciems` |
| `Iela` | `Dzelzavas 95` (+ map link) |
| `Istabas` | `2` |
| `Platība` | `50 m²` |
| `Stāvs` | `5/5` |
| `Sērija` | `LT proj.` |
| `Mājas tips` | `Paneļu` |
| `Ērtības` | `Lodžija, Parkošanas vieta` |
| `Cena` | `68 000 € (1 360 €/m²)` |

Also on the page: `Datums: 25.09.2026 11:03`, `Unikālo apmeklējumu skaits:
1`, breadcrumb `Dzīvokļi / Rīga / Purvciems / Pārdod`, links "Atgriezties
uz sludinājumu sarakstu", "Visi sludinājumi ar šo tālruni", RU/EN toggles.

Car detail, observed verbatim:

| Label | Value |
|-------|-------|
| `Marka` | `Audi` |
| `Modelis` | `Q7` |
| `Izlaiduma gads` | `2007 marts` |
| `Motors` | `3.0 dīzelis` |
| `Ātrumkārba` | `Automāts` |
| `Nobraukums, km` | `345 000` |
| `Krāsa` | `Melna metālika` |
| `Virsbūves tips` | `Apvidus` |
| `Vietu skaits` | `5` |
| `Tehniskā apskate` | `04.2027` |
| `Cena` | `4 700 €` |

Plus a location line (`Valka un raj.` — a car under `/audi/` can be
anywhere in Latvia; region comes from this line, not the URL), a features
checklist in sections `Aprīkojums`, `Salons`, `Stūre`, `Sēdekļi`, `Gaismas`,
`Spoguļi`, `Drošība`, `Hi-Fi` where included items carry the image
`https://i.ss.com/img/kv.gif`, and VIN / registration number behind a
"Parādīt" link (not in HTML by default).

Houses **(probe, 5 details)**: `Pilsēta/pagasts` (`Sigulda`), `Pilsēta,
rajons` (`Rīgas rajons`), `Ciems` (3/5), `Iela`, `Platība` (`54 m²`),
`Stāvu skaits`, `Istabas`, `Zemes platība` (`1000 m²`), `Ērtības` (3/5),
`Kadastra numurs` (1/5 — never store), `Cena`, `Vieta`. The houses region
list needs `/all/`: `/lv/real-estate/homes-summer-residences/riga-region/all/sell/`;
without `/all/` it is a sub-region index with 0 ads.

Random / furniture **(probe, 5 details)**: only `Ražotājs`, `Stāvoklis`
(`lietota`), sometimes `Platums x Garums`. 3/5 had a single photo, so the
quality rule for `random` is ≥ 1 photo. Category indexes such as
`/lv/home-stuff/furniture-interior/` list sub-categories, not ads; crawl
the leaf `/{sub}/sell/` URLs (`chairs`, `carpets`, …).

Cars **(probe)**: `Marka` holds make **and** model (`Volkswagen Touran`);
`Izlaiduma gads` may include a month (`2012 novembris`); `Ātrumkārba` may
include gear count (`Automāts 7 ātrumi`); `Cena` may carry `*PVN iekļauts`
and has the "Aprēķināt apdrošināšanu" link text appended; `Nobraukums, km`
missing on 2/10, `Motors` on 1/10.

### Personal data on the page

Phone is masked server-side as `(+371)26-68-***` with a "Parādīt tālruni"
link; the full number is loaded on click. **We never click it.** Names may
appear in the description; the description is not stored. The flat's
description contained the price and running costs, confirming the rule to
hide title/description in the game.

## Photo URLs

```
list thumb : https://i.ss.com/gallery/8/1549/387154/77430610.th2.jpg
detail thumb: https://i.ss.com/gallery/8/1549/387154/flats-riga-purvciems-77430610.t.jpg
full 800px : https://i.ss.com/gallery/8/1549/387154/flats-riga-purvciems-77430610.800.jpg
cars       : https://i.ss.com/gallery/8/1549/387157/audi-q7-77431329.800.jpg
```

- Path: `/gallery/{shard}/{dirA}/{dirB}/{slug-}{photoId}.{size}.jpg`. Sizes
  seen: `th2` (list), `t` (detail thumb), `800` (full). Store the `.800.jpg`
  URLs in `photo_urls` in page order; the client can derive `.t.jpg` for
  the carousel strip by string replace.
- One ad had photos in **two** directories (`387154` and `387157`),
  consistent with photos uploaded in batches. Do not assume a single folder.
- One flat had 19 photos; car had 10. Cap `photo_urls` at 8.
- Hotlink **(probe)**: `.800.jpg` returns 200 with no Referer, portal
  Referer, foreign Referer, and a phone UA. `Cache-Control: max-age=1209600`
  (14 days), `ETag`, `Last-Modified`. ~52 kB per image. `i.ss.com/robots.txt`
  returns a 1×1 GIF, i.e. no robots file. 11/30 ads had photos in 2–4
  gallery directories.

## Price text formats

| Text | Meaning | Action |
|------|---------|--------|
| `68 000 €` (space or NBSP thousands) | sale price | parse int |
| `68 000 € (1 360 €/m²)` | sale + derived ppm2 | parse first number only |
| `450 €/mēn.` | rent per month | `deal_rent`, drop |
| `25 €/dienā` | car rental per day | `deal_rent`, drop |
| `pērku`, `pērk` | buy request | `deal_buy`, drop |
| `maiņa`, `mainu` | exchange | `deal_change`, drop |
| `vienojoties`, `pēc vienošanās`, empty | no price | `price_missing`, drop |
| `1 360 €` in `Cena, m2` column | per m2 | ignore column |

The fetch tool rendered `68,000 €`; raw HTML uses spaces (probably NBSP).
`parsePrice` must strip `[\s  .,]`.

## Deal-type detection

Three signals, in order of trust:

1. **URL segment**: we only crawl `/sell/` lists, so everything is sell
   unless proven otherwise.
2. **Breadcrumb** on the detail page ends with `Pārdod` (sell), `Pērk`
   (buy), `Izīrē` (rent out), `Īrē` (looking to rent), `Maina` (exchange).
   Mismatch with (1) → reject `deal_mismatch` and log; it means SS moved a
   filter or our URL is wrong.
3. **Price text** patterns above as a safety net (mis-filed rent ads under
   sell do happen, and they show `€/mēn.`).

Buy-requests filed as sell usually have absurdly low prices; the category
minimums in 03 catch those.

## Parsed listing interface

```ts
// scraper/src/types.ts
export type SsCategory = 'flats' | 'houses' | 'cars' | 'land' | 'random';

export interface SsRawListRow {
  sourceUrl: string;            // absolute https://www.ss.com/msg/lv/...
  rowId?: string;               // tr_NNNNNNNN if present (verify)
  titleSnippet: string;
  cells: string[];              // remaining <td> texts, verbatim
  thumbUrl?: string;
  promoted: boolean;
}

export interface SsRawDetail {
  sourceUrl: string;
  breadcrumb: string[];         // ['Dzīvokļi','Rīga','Purvciems','Pārdod']
  attrs: Record<string, string>; // 'Platība' -> '50 m²', verbatim labels
  priceText: string;            // '68 000 € (1 360 €/m²)'
  photoUrls: string[];          // .800.jpg, page order
  postedAtText?: string;        // '25.09.2026 11:03'
  locationText?: string;        // cars: 'Valka un raj.'
  features?: Record<string, string[]>; // cars: section -> checked items
  descriptionLength: number;    // stats only; text is never kept
}

export interface ParsedListing {
  source: 'ss';
  source_url: string;
  category: SsCategory;
  deal: 'sell' | 'rent' | 'buy' | 'change' | 'other';
  price_eur: number | null;
  region: 'riga' | 'riga_region' | 'latvia' | null;
  location: string | null;      // canonical lv district / town
  attributes: ListingAttributes;
  title_hint: string | null;
  photo_urls: string[];
  posted_at: string | null;     // ISO
}

export interface ListingAttributes {
  // flats / houses
  district?: string;            // slug, riga only
  town?: string;
  rooms?: number;
  m2?: number;
  land_m2?: number;
  floor?: number;
  floors_total?: number;
  elevator?: boolean;
  series?: string;
  house_type?: string;          // 'Paneļu' | 'Ķieģeļu' | ...
  amenities?: string[];
  // cars
  make?: string;
  model?: string;
  year?: number;
  engine_l?: number;
  fuel?: 'petrol' | 'diesel' | 'lpg' | 'hybrid' | 'electric';
  gearbox?: 'auto' | 'manual';
  km?: number;
  color?: string;
  body?: string;
  inspection_until?: string;    // '2027-04'
  trim_hint?: string;           // not shown
  // random
  subcategory?: string;
  condition?: string;
  // pipeline
  promoted?: boolean;
  _raw?: Record<string, string>; // dropped after 30 d
}
```

## Field mapping: SS label → `attributes` key

| SS label (lv) | Key | Transform |
|---------------|-----|-----------|
| `Pilsēta` | `town` / sets `region` | `Rīga` → region `riga`; Jūrmala & "Rīgas raj." → `riga_region`; else `latvia` |
| `Rajons` | `district` (Riga) or `town` (elsewhere) | Riga: map lv name → slug via 03 table; also derivable from URL |
| `Iela` | — | **not stored** |
| `Istabas` | `rooms` | int |
| `Platība` | `m2` | strip `m²`, comma → dot |
| `Zemes platība` | `land_m2` | `ha` × 10,000 |
| `Stāvs` | `floor`, `floors_total`, `elevator` | split on `/`, `(lifts)` → true |
| `Stāvi` (houses) | `floors_total` | int |
| `Sērija` | `series` | verbatim |
| `Mājas tips` | `house_type` | verbatim |
| `Ērtības` | `amenities` | split on `, ` |
| `Cena` | `price_eur` (column, not attributes) | parsePrice |
| `Marka` | `make` | prefer URL segment → canonical table |
| `Modelis` | `model` | prefer URL segment; strip trims to `trim_hint` |
| `Izlaiduma gads` | `year` | first 4-digit number |
| `Motors` | `engine_l`, `fuel` | `3.0 dīzelis` → 3.0 / diesel |
| `Ātrumkārba` | `gearbox` | `Automāts` → auto, `Manuāla` → manual |
| `Nobraukums, km` | `km` | strip spaces |
| `Krāsa` | `color` | verbatim (lv) |
| `Virsbūves tips` | `body` | verbatim |
| `Vietu skaits` | — | not stored |
| `Tehniskā apskate` | `inspection_until` | `04.2027` → `2027-04` |
| location line (cars) | `town`, `region` | `Valka un raj.` → town `Valka`, region `latvia` |
| features checklist | — | not stored in v1 (maybe `attributes.features_count` later) |
| `Datums` | `posted_at` → `first_seen_at` if earlier | `dd.mm.yyyy HH:MM` Europe/Riga |

## Crawl plan per night (SS only)

| Category | List URLs | Pages each | List req | Est. new detail req |
|----------|-----------|-----------|----------|---------------------|
| flats Riga | 20 largest district `/sell/` lists | 3 | 60 | 300 |
| flats other | `riga-region`, `jurmala`, `liepaja`, `daugavpils`, `jelgava`, `ogre` `/sell/` | 3 | 18 | 100 |
| houses | `riga-region`, `jurmala`, `all` `/sell/` | 5 | 15 | 120 |
| cars | 25 makes `/sell/` | 2 | 50 | 400 |
| random | 8 allowlisted misc sub-categories `/sell/` | 3 | 24 | 200 |
| **total** | | | ≈ 170 | ≈ 1,100 |

At 2.5 s that is ≈ 55 min of list + detail fetching, leaving budget for
600 rechecks. If the RSS feeds prove usable, list fetching drops to ≈ 20
requests.

## Surprises worth remembering

1. Ad ids are letter strings (`aemdn`), photo ids are numbers; do not
   confuse them.
2. Riga district slugs are SS's own Russian-ish transliterations
   (`yugla`, `bolderaya`, `mezhapark`, `plyavnieki`); the Latvian display name
   must come from our table, not from the slug.
3. A car listed under `/audi/q7/` was physically in Valka; region for cars
   must come from the detail page, not the URL.
4. Phones are already masked in the HTML; the GDPR exposure is in the free
   text, which we do not store.
5. Photos can live in two gallery directories for one ad.
6. `/en/` is fully robots-disallowed; `/lv/` and `/msg/` are not.
7. **(probe)** A phone User-Agent gets `302 → https://m.ss.com/...`, a
   different mobile HTML. The scraper must send a desktop/bot UA. The app
   never fetches SS pages itself, only CDN images, which do not redirect.
8. **(probe)** No rate limiting observed down to 2 req/s over ~180 requests.
   We still run at 2.5 s.

---

## City24.lv (secondary source)

Based on `robots.txt` and two attempted page fetches; no listing data was
retrieved, so this is a plan for the probe, not a spec.

Findings:
- `https://www.city24.lv/lv/nekustamais-ipasums-pardosana/dzivokli/riga`
  answered **302 → `http://city24-ui-legacy/real-estate/riga`**, an internal
  service hostname leaking through the redirect. The old Latvian-slug URLs
  are dead; the current scheme is `/real-estate/...` and
  `/real-estate-search/...` (the latter appears in robots.txt).
- `https://www.city24.lv/lv` returned an empty body to the fetcher: the site
  is a JS single-page app. Listing data is not in the HTML; it comes from an
  API. Expect the same platform as `city24.ee` (robots.txt points to
  `https://static.city24.ee/sm_ee/sitemap.xml`), so the endpoint is likely
  `api.city24.lv/lv_LV/search/realties?...` (**verify**; that is the
  Estonian pattern).
- robots.txt: `User-agent: *` is allowed on `/real-estate-search/*` except
  filtered variants (`price=`, `floor=`, `built=`, `condition=`, `material=`,
  `ec=`, `extras=`), and disallowed on `*ord=*` (sorting), `*category=*`,
  `/favourites`, `/my-*`. No `Crawl-delay`. AI crawlers are named
  explicitly: `ClaudeBot`, `ChatGPT-User`, `PerplexityBot` etc. **allowed**;
  `GPTBot`, `CCBot`, `Google-Extended` **disallowed**; `Yandex` disallowed
  entirely. This is a site that actively manages bot policy; expect them to
  notice traffic and prefer the partnership route (09).
- Because the data endpoint is a JSON API not covered by robots.txt paths,
  and the operator (Baltic Classifieds Group) is a large listed company, treat
  City24 as **partnership-first, scrape-second**. Do not build the City24
  parser until the BCG email from Phase 0 has been answered or 4 weeks have
  passed.

Probe plan (≤ 2 page loads in a real browser with DevTools, no scraping):
1. Open Riga flats search, record the XHR that returns listings: URL, query
   parameters (page size, offset, `adReach`, `deal_type`), response shape,
   whether an API key / token header is required.
2. Open one listing, record the detail endpoint, image CDN pattern
   (`c24-media` or similar), and whether district names are Latvian.

Expected mapping if the Estonian schema holds: `price`, `property_size`
(m2), `rooms`, `floor`, `total_floors`, `year_built`, `address.district`,
`address.city`, `images[].url`, `friendly_id` → `source_url`. Fill in
`ListingAttributes` with the same keys as SS so the game does not care about
the source.
