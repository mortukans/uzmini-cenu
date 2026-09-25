# Phase 0 probe: SS.com — results

Filled in from the `tools/probe` run. Raw JSON in `tools/probe/out/`
(git-ignored). Numbers here set the defaults in 03-data-pipeline and
12-ss-scraper-spec.

- Date run: **2026-09-25, 08:30–08:45 UTC (11:30–11:45 Riga)**
- Script: `tools/probe/probe.ts` (commands robots, discover, rate, hotlink, report)
- Machine / IP type: Windows dev machine, office/home IP, single IP
- User-Agent used: `UzminiCenuProbe/0.1 (+mailto:mortukans@gmail.com)`
- robots.txt re-checked: **yes, unchanged** vs the 2026-09-25 baseline in 12
- Total requests this evening: **≈ 330** (2 robots, 47 discover, 195 rate, 21 hotlink, 15 browser-UA, plus a partial re-discover). Zero 403/429, zero captcha.

## 1. Rate and blocking

50 detail fetches per interval (30 at 0.5 s), honest bot UA, serial.

| Interval | Requests done | 200 | 403/429 | Captcha / redirect | Median ms | p95 ms | Notes |
|----------|---------------|-----|---------|--------------------|-----------|--------|-------|
| 5.0 s | 50 | 50 | 0 | 0 | 74 | 279 | first run, cold |
| 2.5 s | 50 | 50 | 0 | 0 | 13 | 100 | many URLs repeated from the 5 s run, likely server cache |
| 1.0 s | 50 | 50 | 0 | 0 | 12 | 117 | |
| 0.5 s | 30 | 30 | 0 | 0 | 13 | 125 | |

- First block symptom seen: **none**. No block at any interval down to 2 req/s across ~180 requests within 8 minutes.
- Recovery time after block: n/a.
- Browser-like UA (iPhone Safari) vs honest bot UA: **iPhone UA gets `302 → https://m.ss.com/msg/lv/...`** (mobile site). Bot UA and desktop get the full desktop page. Scraper must use a desktop or bot UA; m.ss.com is a different HTML we have not looked at.
- Logged-in vs anonymous: **not tested yet** (manual, day 2).
- Chosen production interval: **2.5 s ± 0.5 s stays** (03). The site tolerates far more, but nothing in the plan needs it, and politeness is part of the partnership pitch.
- Pages are served fast (12–80 ms) and are 20–60 kB. A full night at 2.5 s ≈ 3,000 pages ≈ 120 MB.

## 2. HTML stability and parser coverage

All the "verify" items from 12 are now confirmed.

| Page type | URL sampled | Anchors found | Rows parsed | Price parsed | Photos ≥ 2 | Missing fields |
|-----------|-------------|---------------|-------------|--------------|------------|----------------|
| flats list | `/lv/real-estate/flats/riga/purvciems/sell/`, `/centre/sell/` | `tr#tr_N`, `a.am#dm_N`, `td.msga2`, `td.msga2-o.pp6`, `td.msg2` | 30/30 each | 30/30 | (thumb only) | — |
| flats detail ×10 | purvciems, centre | `td.ads_opt_name`, `td.ads_opt`, `td.ads_price`, `#msg_div_msg`, `.ads_photo_label` | — | 10/10 | 10/10 | Ērtības 8/10 (optional) |
| houses list | `/lv/real-estate/homes-summer-residences/riga-region/all/sell/` | same | 30/30 | 30/30 | | note: `/riga-region/sell/` **without `/all/`** is an index page with 0 ads |
| houses detail ×5 | Sigulda, Babīte, Garkalne, Olaine, Sēja | same | — | 5/5 | 5/5 | labels differ, see below |
| cars list | `/lv/transport/cars/audi/sell/`, `/volkswagen/sell/` | same, plus `td.msga2-r` | 30/30 each | 30/30 | | |
| cars detail ×10 | A4, A6, A7, Golf, Tiguan, Touran… | same | — | 10/10 | 10/10 | Nobraukums 8/10, Motors 9/10 |
| random list (chairs, carpets) | `/lv/home-stuff/furniture-interior/chairs/sell/`, `/carpets/sell/` | same | 30/30 each | 30/30 | | `/furniture-interior/` alone is an index (0 ads) |
| random detail ×5 | chairs, carpets | same | — | 5/5 | **2/5** | only Ražotājs, Stāvoklis, sometimes Platums x Garums |

- Row markup **confirmed**: `<tr id="tr_58114044">` (numeric), title link `<a class="am" id="dm_58114044" href="/msg/lv/...">`, thumb in `td.msga2`, data cells `td.msga2-o pp6`. The ad id in the URL is still a letter string (`aemdn`); `tr_` numeric id is a third sequence.
- Rows per list page: **30** (not 33; the earlier count included two nested wrapper rows). Promoted rows: none seen with a distinct class on these pages.
- **List-page prices use a comma thousands separator (`68,000 €`, `1,360 €`), detail pages use a space (`68 000 €`).** `parsePrice` must strip both. Car list mileage is `175 tūkst.`; detail is `218 400`.
- Detail labels end with a colon in the HTML (`Pilsēta:`); strip it.
- Extra labels found: `Vieta` (location; `Rīga` for flats, `Talsi un raj.` for cars, `Rīgas rajons` for houses) — **use this for region, not the URL**. `Uzņēmums` (dealer/agency, 3/10 flats, several cars), `Adrese` + `Darbalaiks` on dealer ads (not stored), `VIN kods` / `Valsts numura zīme` behind "Parādīt" links.
- Houses labels: `Pilsēta/pagasts` (e.g. Sigulda), `Pilsēta, rajons` (Rīgas rajons), `Ciems` (3/5), `Stāvu skaits`, `Zemes platība` (`1000 m²`), `Kadastra numurs` (1/5, never store).
- Cars: `Marka` cell contains make **and** model (`Volkswagen Touran`); `Izlaiduma gads` may include a month (`2012 novembris`); `Ātrumkārba` may include gear count (`Automāts 7 ātrumi`); price may carry `*PVN iekļauts`; `Cena` cell has "Aprēķināt apdrošināšanu" link text appended.
- Deal slugs: only `/sell/` crawled; all 30 sampled details had a sale price, 0 rent/buy leaks. Breadcrumb ends in `Pārdod`.
- RSS: link present on every list page (`.../sell/rss/`). **Not fetched yet** — day 2 item.
- Ads with two or more gallery directories: **11/30** (up to 4 dirs on one ad). Never assume one folder.
- Photos per ad (uncapped): flats 3–35, houses 7–35, cars 9–35, random 1–6. Cap of 8 in `photo_urls` is fine.

## 3. Photo hotlinking (i.ss.com)

20 `.800.jpg` URLs, 5 per case.

| Test | Result |
|------|--------|
| GET `.800.jpg` with no Referer | **200**, `image/jpeg`, 5/5 |
| GET with `Referer: https://www.ss.com/` | **200**, 5/5 |
| GET with `Referer: https://uzminicenu.lv/` (foreign) | **200**, 5/5 — no hotlink protection |
| GET with iPhone Safari UA, no Referer | **200**, 5/5 |
| GET from iPhone (Expo dev client) | not yet — needs P0.7 dev build |
| `Cache-Control` / `Expires` | `max-age=1209600` (14 days), `Expires` +14 d, `ETag` and `Last-Modified` present |
| URL still 200 after ad removed? | day 2 / day 4 recheck |
| `https://i.ss.com/robots.txt` | returns **200 with a 1×1 GIF**, i.e. no robots file at all on the CDN |
| Average `.800.jpg` size | **≈ 52 kB** |

- Verdict: **direct CDN links are technically viable for v1.** No Referer check, 14-day browser cache headers, ~50 kB per image. Legal question (09) unchanged.

## 4. Data quality sample (30 details, script-checked; hand check still to do)

| Issue | flats /10 | houses /5 | cars /10 | random /5 |
|-------|-----------|-----------|----------|-----------|
| Rent mis-filed under sell | 0 | 0 | 0 | 0 |
| Buy request under sell | 0 | 0 | 0 | 0 |
| Price missing / vienojoties | 0 | 0 | 0 | 0 |
| Price outside 03 thresholds | 0 | 0 | 0 | 0 (5–380 €) |
| Fewer than 2 photos | 0 | 0 | 0 | **3** |
| Duplicate (same photos) | 0 | 0 | 0 | 0 |
| Phone visible in HTML without click | 0 (masked `(+371)27-72-***`) | 0 | 0 | 0 |
| Emails in page | 0 | 0 | 0 | 0 |
| Dealer/agency ad (`Uzņēmums`) | 3 | 0 | ≥3 | 1 |

- The script's "full phone" counter fired once per page on `hits.puls.lv/?sid=232-26935-…`, a page-view counter, not a phone number. Real exposure is zero; phones are masked server-side.
- Proposed threshold changes for 03: **random needs a 1-photo minimum, not 2** (3/5 chairs and carpets had one photo). Keep 2 for flats/houses/cars.
- Hand check of titles for price leaks: not done yet (day 2, 30 titles).

## 5. Expiry behaviour

Not measured yet. Run `npm run recheck` on **2026-09-26** and **2026-09-28**.

## 6. City24

Not touched. Manual DevTools session on day 2 (≤ 2 page loads). Partnership-first stance from 12 stands.

## 7. Decisions

- Scraping SS viable at production interval? **Yes.** No blocking down to 2 req/s; 2.5 s is comfortably polite.
- Photo strategy: **direct CDN links** for v1 (no Referer check, 14-day cache). Proxy fallback stays designed but unbuilt.
- City24: partnership-first confirmed; BCG email **not yet sent**.
- SS partnership email: **not yet sent**.
- Items to update in 03 / 12: done 2026-09-25 (row markup confirmed, comma prices on list pages, `Vieta`, houses labels, `/all/` in houses URL, mobile redirect for phone UAs, random 1-photo rule, i.ss.com has no robots.txt).

## Open items for day 2

1. `npm run recheck` (expiry + photo survival).
2. Fetch one RSS feed by hand and note item count, fields, whether the price is included.
3. Logged-in vs anonymous comparison in a browser.
4. Hand-check 30 titles for price leaks.
5. City24 DevTools look.
6. Delete `tools/probe/out/raw/` afterwards (contains ad text).
