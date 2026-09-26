# 08 Roadmap

## Status snapshot — 2026-09-26

Built in one day (2026-09-25) instead of 11 weeks; the plan below is kept as the reference, this block is the truth.

| Phase | Done | Not done / changed |
|-------|------|--------------------|
| 0 De-risk | P0.1 probe, P0.4 Apple account, P0.7 repo/Expo/Supabase | P0.2 City24 probe, P0.3 partnership emails, P0.5 domain (using GitHub Pages instead of uzminicenu.lv), P0.6 lawyer |
| 1 Data + solo | P1.1–P1.10 all done; scraper runs nightly on GitHub Actions | P1.11 scoring playtest with 5 people (k=8 unvalidated) |
| 2 Daily + accounts | P2.1 (anonymous + username; Apple sign-in dropped by decision), P2.2–P2.4, P2.6, P2.8 | P2.5 universal links need the domain (custom scheme works, GitHub Pages fallback), P2.7 PostHog/Sentry code present but keys unset, P2.9 friends test |
| 3 Duel | P3.1–P3.8 code complete, smoke-tested via RPC and web | never tested on two real phones |
| 4 Monetization + polish | P4.4 onboarding, P4.5 icon/screenshots/privacy labels, P4.6 settings | P4.1 ads and P4.3 RevenueCat dropped (free app decision); P4.2 hints partial (bracket hint disabled); P4.7/P4.8 beta with 30 testers skipped |
| 5 Launch | P5.1 submitted (build 21, awaiting reply to Guideline 2.1 info request), P5.2 site live | P5.3 press kit, P5.4 launch week, P5.5 monitoring (no Sentry/PostHog keys) |
| 6 v1.1 | P6.1 party rooms already built | P6.2–P6.6 |


Solo dev, evenings and weekends, budget ~15 h/week. Estimates are working
hours (h); phase lengths are calendar weeks at that pace. Total to launch:
~165 h over 11 weeks, week 12 is buffer.

Task ids are `P<phase>.<n>`. "Depends" lists task ids or external events.
"Done when" is the definition of done: a checkable statement, not a feeling.

## Phase 0: De-risk (week 1, ~15 h)

| Id | Task | h | Depends | Done when |
|----|------|---|---------|-----------|
| P0.1 | Probe script for SS.com (flats + cars), see detail below. **Done 2026-09-25** (`tools/probe/`, results in `docs/notes/ss-probe.md`; day-2/day-4 `recheck` still pending) | 4 | - | `docs/notes/ss-probe.md` filled in with every metric from the probe plan |
| P0.2 | Probe script for City24 | 2 | P0.1 (reuse code) | `docs/notes/city24-probe.md` filled in |
| P0.3 | Send partnership emails (SS.com, City24 / BCG) | 1 | P0.5 (name chosen) | both emails sent from a domain address, copies saved in `docs/notes/outreach.md` with dates |
| P0.4 | Apple Developer enrolment | 1 + wait | - | account shows "Active", bundle id registered, App Store Connect app record created |
| P0.5 | Name + domain decision | 2 | - | name checklist below fully ticked, `.lv` domain registered, name written into README |
| P0.6 | Lawyer consult (1 h) on 09-legal-risks | 2 (prep + call) | P0.1 findings | answers to the lawyer question list in 09 recorded in `docs/notes/lawyer.md` |
| P0.7 | Set up repo, Expo project, EAS project, Supabase dev project | 3 | P0.4 (bundle id) | `eas build --profile development` succeeds once (can be a blank app) |

Exit: we know whether scraping is viable, we have a name, and a dev build
installs on the iPhone.

### P0.1 / P0.2 probe script plan

Throwaway Node/TS script in `tools/probe/`, never shipped. Runs from home IP
with an honest User-Agent `UzminiCenuProbe/0.1 (+mailto:...)`. Records
everything to a JSON log, summarised by hand into `docs/notes/*-probe.md`.

What it measures:

| Metric | How | Why it matters |
|--------|-----|----------------|
| robots.txt rules | fetch `/robots.txt`, list disallowed paths for list/detail pages | tells us which paths are off limits before anything else |
| Rate tolerance | fetch 50 list pages at 1 req / 3 s, then 1 req / 1 s, then 2 req / s; log status codes, response time, first 403/429/captcha | sets the scraper politeness ceiling in 03 |
| Block recovery | after a block, wait 10 / 60 / 600 s and retry once each | tells us whether "stop for 24 h" is enough |
| HTML stability | save 5 detail pages, diff selectors across 3 consecutive days | estimates maintenance cost of the parser |
| Price parsing | parse price, deal type (sale vs rent), currency from 50 flats + 50 cars; count parse failures and "cena pēc vienošanās" | validates quality filters in 03 |
| Attribute coverage | % of listings with each attribute we plan to show (m2, rooms, floor, year, km) | decides what the round screen can rely on |
| Photo hotlinking | fetch 20 photo URLs with no Referer, with portal Referer, with our app-like Referer; log status + content type | decides direct CDN vs proxy (10-open-questions #6) |
| Photo URL lifetime | re-fetch the same photo URLs 24 h and 72 h later | decides snapshot strategy for daily sets |
| Logged-in delta | compare one page anonymous vs logged-in browser (manual) | check we are not missing data or seeing a degraded page |
| Listing churn | re-check 50 listings after 24 h and 72 h, count expired | sets `checked_at < 72h` rule |
| PII exposure | grep saved HTML for phone / email patterns | confirms the sanitisation list in 03 |
| Photo count distribution | histogram of photos per listing | validates "fewer than 2 photos" filter |

Abort rule: on any captcha or 403, stop immediately, log it, do not retry
with another IP. The probe is also a test of our own discipline.

### P0.3 partnership email drafts

Send from `<name>@<domain>.lv`, plain text, no attachments. One email per
portal, adjusted to the contact (SS.com: general info address from their
site; City24: Baltic Classifieds Group Latvia country manager or
partnerships address, found via LinkedIn / company site). Follow up once
after 10 working days, then let it rest.

#### Latvian version

```
Temats: Sadarbības piedāvājums – spēle "Uzmini Cenu" ar saitēm uz jūsu sludinājumiem

Labdien!

Mani sauc Mārtiņš Mortukāns, es esmu neatkarīgs izstrādātājs no Rīgas.
Veidoju mobilo spēli "Uzmini Cenu": spēlētājs redz reālu sludinājumu
(dzīvoklis, māja, auto vai kāds jocīgs priekšmets), min tā cenu un saņem
punktus par precizitāti. Tā ir "GeoGuessr" ideja, pārnesta uz Latvijas
cenām. Viena spēle dienā visiem ir vienāda, rezultātu var kopīgot ar
draugiem.

Kāpēc rakstu jums:

1. Katra raunda beigās ir poga "Atvērt sludinājumu", kas ved tieši uz
   jūsu portālu. Spēle ir bezmaksas satiksme jums un iemesls cilvēkiem
   pārlūkot sludinājumus arī tad, kad viņi neko nemeklē.
2. Es vēlos to darīt pareizi. Lūdzu jūsu rakstisku atļauju spēlē
   attēlot sludinājuma faktus (cena, platība, rajons, gads u.c.) un
   fotogrāfijas, ielādējot tās tieši no jūsu servera un vienmēr
   norādot avotu ar jūsu logo un saiti. Es neglabāju fotogrāfijas savā
   pusē un nerādu kontaktinformāciju vai precīzas adreses.
3. Piedāvāju "sponsorētu dienas komplektu": vienu dienu nedēļā visi
   pieci sludinājumi var būt no jūsu izvēlēta sadaļas vai partnera,
   skaidri marķēti kā jūsu.

Tehniski es varu strādāt ar jebkuru jums ērtu veidu: publisks API, XML
plūsma vai retas, pieklājīgas pieprasījumu sērijas no vienas IP adreses
ar identificējamu User-Agent.

Vai varētu sarunāt 20 minūšu zvanu? Labprāt parādīšu prototipu.

Ar cieņu,
Mārtiņš Mortukāns
<telefons> · <e-pasts> · <domēns>.lv
```

#### English version

```
Subject: Partnership proposal – "Uzmini Cenu" game linking back to your listings

Hello,

My name is Mārtiņš Mortukāns, an independent developer based in Riga.
I am building a mobile game called "Uzmini Cenu" (Guess the Price): the
player sees a real listing (flat, house, car, or an odd household item),
guesses its asking price and is scored on accuracy. Think GeoGuessr for
Latvian prices. Everyone gets the same five listings each day and can
share their result with friends.

Why I am writing to you:

1. Every round ends with an "Open listing" button that leads straight to
   your portal. The game is free traffic and a reason for people to
   browse listings even when they are not shopping.
2. I want to do this properly. I am asking for your written permission to
   display listing facts (price, size, district, year, etc.) and photos
   in the game, with photos loaded directly from your servers and the
   source always credited with your logo and a link. I do not store
   photos on my side and never show contact details or exact addresses.
3. I would like to offer a "sponsored daily set": one day a week, all
   five listings can come from a section or partner of your choice,
   clearly labelled as yours.

Technically I can work with whatever suits you: a public API, an XML
feed, or infrequent, polite requests from a single IP with an
identifiable User-Agent.

Could we set up a 20-minute call? I would be glad to show the prototype.

Best regards,
Mārtiņš Mortukāns
<phone> · <email> · <domain>.lv
```

Adjust the City24 version: mention Baltic Classifieds Group by name, and
that City24 is the preferred source for flats and houses because of photo
quality.

### P0.4 Apple Developer enrolment steps

1. Create or reuse an Apple ID with two-factor auth; use a personal email
   you will keep. Enrol as **Individual** unless you already have an SIA;
   individual is faster (usually 24-48 h) and shows your personal name on
   the store. Switching to an organisation later requires a D-U-N-S number
   and a new enrolment, so decide now (see 10-open-questions).
2. developer.apple.com/programs → Enroll → pay €99/yr. Have passport for
   identity verification (Apple Developer app on iPhone is the fastest
   path; it works on the iPhone without a Mac).
3. After approval: Certificates, Identifiers & Profiles → register bundle
   id `lv.<domain>.uzminicenu` (explicit, not wildcard). Enable
   capabilities: Sign in with Apple, Push Notifications, Associated
   Domains (universal links for `/r/KTRP` and daily share links).
4. App Store Connect → New App → iOS, name (reserved for 90 days once an
   app record exists), primary language Latvian, bundle id, SKU
   `uzminicenu-ios`.
5. Agreements, Tax, and Banking → accept Paid Apps agreement, enter bank
   and tax info (needed before RevenueCat products can be tested).
6. Create an App Store Connect API key (Admin role) and store it in EAS
   (`eas credentials`) so `eas build` / `eas submit` run without a Mac.
7. Users and Access → add your own iPhone via TestFlight internal testing
   (no UDID registration needed when using TestFlight).
8. Enable Sign in with Apple key (Keys tab) for Supabase Auth Apple
   provider; note Team ID, Key ID, Services ID.

### P0.5 name / domain checklist

Candidate names: "Uzmini Cenu", "Cik Maksā?", "Cenu Guru". For each
candidate, tick all:

- [ ] App Store search: no existing app with the same or confusable name
      in LV / EU storefronts.
- [ ] Google Play search (Android later).
- [ ] `.lv` domain free (nic.lv) and registered for 2 years.
- [ ] `.com` or `.app` free or acceptable to skip.
- [ ] Latvian trademark search (LRPV database) and EUIPO eSearch for the
      word mark in class 9 / 41. No filing yet, just no obvious conflict.
- [ ] Instagram, TikTok, X handles available (or a close variant).
- [ ] Does not contain "SS", "City24", "BCG" or any portal brand.
- [ ] Works in Russian and English contexts (no unfortunate meaning).
- [ ] Pronounceable in a podcast, spellable after hearing it once.
- [ ] Short enough for the App Store title (30 chars) with a subtitle.
- [ ] The existing furniture-shop promo "Uzmini cenu" is a campaign, not a
      registered mark; confirm with the lawyer in P0.6 before committing.

Output: name written into README, domain in a password manager, App Store
Connect record created under that name.

## Phase 1: Data + solo play (weeks 2-4, ~45 h)

| Id | Task | h | Depends | Done when |
|----|------|---|---------|-----------|
| P1.1 | Supabase prod project (EU), migrations for `listings`, `guesses`, RLS baseline from 05 | 3 | P0.7 | `supabase db push` clean on dev and prod, `listings` unreadable from anon key |
| P1.2 | Scraper core: fetch, politeness (1 req / 2-3 s), robots.txt, stop-on-block, idempotent upsert by `source_url` | 6 | P0.1 | 100 SS flats in `listings` from one run; second run inserts 0 duplicates |
| P1.3 | SS parsers: flats, houses, cars, random (list + detail) | 8 | P1.2 | unit tests in 13-testing-qa pass on saved fixtures for all 4 categories |
| P1.4 | Quality filters + sanitisation (price range, rent, photo count, PII strip, price leak in title, dedupe by phash) | 5 | P1.3 | rejected listings have `status = rejected` with a reason in `attributes.reject_reason`; PII regex test suite passes |
| P1.5 | Nightly cron (Edge Function or Fly.io), expiry re-check job, alert on zero new rows | 3 | P1.4 | 3 consecutive nights of runs visible in logs; 1,000+ active listings |
| P1.6 | RPCs `get_rounds`, `submit_guess`, signed round token (HMAC, single use, bound to session) | 5 | P1.1 | token test suite passes; replaying a token returns an error |
| P1.7 | Expo app skeleton: Router tabs, Supabase client, Zustand, TanStack Query, i18n scaffold (lv default) | 4 | P0.7 | dev client from EAS runs on the iPhone with hot reload from Windows |
| P1.8 | Round screen: photo carousel (expo-image, prefetch next), attributes, numeric pad with category-specific steps | 6 | P1.7, P1.6 | 10 rounds of real flats playable end to end on device |
| P1.9 | Reveal screen: price count-up, error %, score, "open on SS.com" attribution link | 3 | P1.8 | animation runs at 60 fps on iPhone 11 or newer; link opens the portal |
| P1.10 | Solo free play + streak mode, category / region filter, 10-round session summary, best streak stored locally | 4 | P1.9 | both modes selectable from home; best streak survives app restart |
| P1.11 | Scoring playtest with 5 people (exponential k=8 vs "within X%"), decide k | 3 | P1.10 | decision recorded in 02-game-design with the playtest numbers |

Exit: 20 rounds of real Riga flats on your phone, and it feels good.

## Phase 2: Daily challenge + accounts (weeks 5-6, ~30 h)

| Id | Task | h | Depends | Done when |
|----|------|---|---------|-----------|
| P2.1 | Auth: anonymous session on first launch, Sign in with Apple upgrade, `profiles` row, username picker | 5 | P1.7, P0.4 step 8 | anonymous → Apple upgrade keeps the same `profiles.id` and past guesses |
| P2.2 | `build_daily` job: seeded selection (2 flats, 1 house, 1 car, 1 random, active ≥ 24 h), snapshot into `daily_sets` at 00:05 Riga time | 4 | P1.5 | 7 consecutive daily sets exist; preview of tomorrow's set visible in Studio |
| P2.3 | RPCs `get_daily`, `submit_daily`, unique `(day, user_id)` | 3 | P2.2, P2.1 | second submit for the same day is rejected server-side |
| P2.4 | Daily screen: 5 rounds, result screen, grid text, share sheet with deep link | 5 | P2.3, P1.9 | share text matches 02 format; tapping the link on a phone with the app opens today's challenge |
| P2.5 | Deep links / universal links config (`apple-app-site-association` on the domain) | 2 | P0.5 | link from iMessage opens the app, not Safari |
| P2.6 | Leaderboard RPC + screen (global day / week) | 4 | P2.3 | leaderboard shows 10 test users correctly ordered, own row highlighted |
| P2.7 | PostHog EU + Sentry, event plan (see 07 metrics) | 3 | P1.7 | events `round_completed`, `daily_shared`, `signup_completed` visible in PostHog; a forced crash appears in Sentry |
| P2.8 | Account deletion in-app (App Store requirement), push token cleanup | 2 | P2.1 | deleting the account removes `profiles`, `guesses`, `daily_results` rows and signs out |
| P2.9 | Friends-and-family test: 10 people, same daily set, results shared in a group chat | 2 | P2.4 | 10 grids posted in the chat on one day; feedback notes filed |

Exit: 10 friends play the same daily set and share results in a group chat.

## Phase 3: Duel (weeks 7-8, ~30 h)

| Id | Task | h | Depends | Done when |
|----|------|---|---------|-----------|
| P3.1 | Friends: username search, `friendships` request / accept, invite link | 4 | P2.1 | two test accounts become friends via link |
| P3.2 | Push: Expo push token registration, permission prompt timing (after first daily), `notify-duel` Edge Function | 4 | P2.1 | a push from the Expo tool arrives on the device and deep-links |
| P3.3 | `invite_duel` RPC: pick 5, snapshot with prices, insert, trigger push | 3 | P3.2, P1.6 | duel row + push within 5 s of tapping "challenge" |
| P3.4 | Duel screen: realtime channel `duel:{id}`, per-round wait for both or 30 s, reveal both guesses | 8 | P3.3 | two phones, one invite push, five synced rounds |
| P3.5 | Async path: accept after 24 h, result push when both done, `expired` after 7 days (pg_cron) | 4 | P3.4 | simulated clock test passes; expired duel shows correct state on both phones |
| P3.6 | Rematch, win / loss record per pair, duel history on friends tab | 3 | P3.4 | rematch creates a new duel with swapped roles; record increments |
| P3.7 | Reconnect handling: refetch on foreground, resume from `current_round` | 2 | P3.4 | killing the app mid-duel and reopening resumes the correct round |
| P3.8 | Daily duel cap (3 free) enforced server-side | 2 | P3.3 | 4th invite of the day returns a paywall error code |

Exit: two phones, one invite push, five synced rounds.

## Phase 4: Monetization + polish (weeks 9-10, ~30 h)

| Id | Task | h | Depends | Done when |
|----|------|---|---------|-----------|
| P4.1 | AdMob: SDK in dev client, ATT prompt, interstitial every 5 solo rounds, rewarded ad for hint, test ids | 5 | P1.10 | test interstitial shows after round 5 and 10; rewarded ad grants a hint |
| P4.2 | Hint system (title, price bracket, extra photo) with score cost | 3 | P4.1 | hint reduces max score as per 02; premium bypasses ad |
| P4.3 | RevenueCat: products from 07, entitlement `plus`, paywall screen lv/en/ru, 7-day trial, restore purchases | 6 | P0.4 step 5 | sandbox purchase flips `profiles.is_premium` via webhook; ads disappear; duel cap lifted |
| P4.4 | Onboarding: 3 practice rounds, then soft sign-in prompt | 3 | P2.1 | new install reaches first reveal in under 60 s without any prompt |
| P4.5 | App icon, splash, App Store screenshots (see 14), privacy nutrition labels (see 09) | 5 | P4.4 | 6 screenshots exported for 6.7" and 6.1"; icon passes App Store validation |
| P4.6 | Settings: language switch lv/ru/en, notifications toggle, delete account, privacy policy and terms links | 2 | P2.8 | all three languages render every screen without missing-key fallbacks |
| P4.7 | TestFlight external beta: 30 testers, 2 weeks, feedback form (see 13) | 4 | P4.5 | beta build approved by TestFlight review; 30 installs; form has 15+ responses |
| P4.8 | Beta fixes: scoring feel, crashes, top 5 feedback items | 2 + carry-over | P4.7 | Sentry crash-free sessions > 99%; top 5 items closed or explicitly deferred |

## Phase 5: Launch (week 11, ~15 h)

| Id | Task | h | Depends | Done when |
|----|------|---|---------|-----------|
| P5.1 | Production build, App Store submission with review notes (see 14) | 3 | P4.8 | status "Waiting for Review" |
| P5.2 | Landing page: today's blurred first photo, grid, App Store badge, privacy / terms / support pages | 4 | P2.5 | page live at the domain, Lighthouse mobile > 90 |
| P5.3 | Press kit: 3 screenshots, icon, 100-word blurb lv/en, founder photo, contact | 2 | P4.5 | folder shared via public link |
| P5.4 | Launch week execution per 07 day-by-day plan | 4 | P5.1 approved | every day's item posted; metrics screenshot saved |
| P5.5 | Post-launch monitoring: Sentry, PostHog, scraper alerts, App Store reviews, takedown inbox | 2 / week | P5.1 | daily check for 2 weeks logged in `docs/notes/launch-log.md` |

## Phase 6: v1.1 (weeks 13+)

| Id | Task | h | Depends |
|----|------|---|---------|
| P6.1 | Party rooms per 06 (create/join, lobby presence, trigger-driven round advance, podium) | 20 | P3.4 |
| P6.2 | Sponsored daily set tooling (Studio-level: tag a set as sponsored, sponsor logo, label) | 6 | P2.2 |
| P6.3 | Android build via EAS, Play Console listing | 8 | P5.1 |
| P6.4 | City24 as second source | 8 | P1.3, partnership reply |
| P6.5 | Numbers-only "sold for" mode from Kadastrs open data | 12 | lawyer OK |
| P6.6 | Referral mechanics from 07 | 6 | P3.1 |

## Weekly calendar

| Week | Phase | Focus | Milestone at end of week |
|------|-------|-------|--------------------------|
| 1 | 0 | Probes, emails, Apple enrolment, name, lawyer, repo | Dev build installs on iPhone; probe notes written |
| 2 | 1 | Supabase migrations, scraper core, SS flats + cars parsers | 500 real listings in prod DB |
| 3 | 1 | Houses + random parsers, filters, cron, RPCs + round token | Nightly job runs; `get_rounds` returns clean rounds |
| 4 | 1 | Round screen, reveal, solo + streak, scoring playtest | 20 rounds feel good; k decided |
| 5 | 2 | Auth, `build_daily`, `submit_daily` | You and one friend play the same daily set |
| 6 | 2 | Share grid, deep links, leaderboard, PostHog, Sentry, deletion | 10 friends share grids in a chat |
| 7 | 3 | Friends, push, `invite_duel` | Push invite arrives and opens the duel |
| 8 | 3 | Realtime duel, async path, rematch, reconnect | Two phones, five synced rounds |
| 9 | 4 | AdMob, hints, RevenueCat paywall | Sandbox purchase removes ads |
| 10 | 4 | Onboarding, icon, screenshots, labels, TestFlight external beta starts | 30 testers installed |
| 11 | 4→5 | Beta fixes, submission, landing page, press kit | "Waiting for Review" |
| 12 | 5 | Buffer for review rejection; launch week if approved | Live on the App Store in LV |

## What to cut if behind

In order, cut from the top. Each line names what is removed and what stays.

1. **Russian UI at launch** → ship lv + en, add ru via EAS Update in week 13.
   Saves ~4 h.
2. **Hint system + rewarded ads (P4.2, half of P4.1)** → keep interstitials
   only. Saves ~5 h. Hints were already flagged v1.1 in 10-open-questions.
3. **Streak mode (part of P1.10)** → free play only. Saves ~2 h.
4. **Async duel path + 7-day expiry (P3.5)** → invites expire after 24 h,
   no async play. Saves ~4 h.
5. **Friends leaderboard scope** → global only until v1.1. Saves ~2 h.
6. **Landing page with today's photo (P5.2)** → one static page with badge,
   privacy, terms, support. Saves ~3 h.
7. **Region filter beyond Riga / Latvia** → Riga districts as filter moved
   to v1.1. Saves ~2 h.
8. **Houses + random parsers (part of P1.3)** → launch with flats + cars,
   daily set becomes 3 flats + 2 cars. Saves ~4 h. Painful because
   "random" is the marketing hook; cut last among content.
9. **Duel entirely (Phase 3)** → launch as solo + daily, duel in v1.1. Saves
   ~30 h. Only if more than 3 weeks behind. Daily challenge is the growth
   loop and must not be cut.

Never cut: daily challenge, share grid, account deletion, privacy labels,
kill switch per source, attribution link on every reveal.
