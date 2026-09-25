# 07 Monetization and growth

> **Decision 2026-09-25:** free app, no premium tier, ads off at launch (`ADS_ENABLED=false`, code kept).
> Accounts are device-unique anonymous Supabase users with a chosen username instead of Sign in with Apple.
> Everything below about Plus / RevenueCat / paywall is historical; limits are flat (20 duel invites, 20 rooms per day).

## Lesson from Housle

Monetization must exist before any viral moment. Housle converted a random
Barstool podcast mention into hundreds of premium signups only because ads
and premium were already live. Press gives curious clicks, not retention;
the daily habit and friends do.

## Free tier

- Unlimited solo free play with an interstitial ad every 5 rounds.
- Daily challenge, always free, no ads inside it (protect the sharing loop).
- 3 duels per day.
- Rewarded video for a hint.

## Ads (AdMob via react-native-google-mobile-ads)

### Placements

| Id | Format | Where | Frequency / rule | Why here |
|----|--------|-------|------------------|----------|
| `solo_interstitial` | Interstitial | Solo free play and streak, shown on the reveal screen *after* the score animation finishes, before "next round" | every 5th round, never in the first session's first 5 rounds, never twice within 90 s | reveal is a natural pause; the score has landed so the ad does not steal the moment |
| `hint_rewarded` | Rewarded video | Round screen, "Get a hint" button | on demand, max 1 per round, hint list per 02 | user-initiated, highest eCPM format |
| `streak_continue_rewarded` | Rewarded video | Streak game-over screen, "Continue once" | max 1 per streak run | classic casual pattern, feels like a gift |
| `session_summary_banner` | Adaptive anchored banner | Bottom of the 10-round session summary only | shown while the summary is open | low value, low annoyance; skip if it looks cheap in beta |

Not placed, on purpose: inside the daily challenge, inside duels or rooms,
on the home screen, on onboarding. Premium removes all four placements.

Implementation notes:
- Needs the EAS dev client (native module). Use Google test ad unit ids in
  `dev`, real ids only in the `production` profile via EAS env.
- App Tracking Transparency prompt shown once, after the first daily result
  (user is already engaged). Expect ~25-35% opt-in on iOS; the rest get
  non-personalised ads, which halves eCPM. Configure the UMP consent form
  for EU (GDPR) users; Latvia is in scope.
- Preload the interstitial at round 3 so it is ready by round 5. If not
  loaded, skip silently; never block the game on an ad.
- Log `ad_shown`, `ad_failed`, `ad_rewarded` to PostHog with placement id.

### Expected eCPM for Latvia (rough assumptions, verify in beta)

Latvia is a small, low-tier ad market on iOS. Treat these as planning
numbers, not forecasts; real numbers appear in the AdMob dashboard after
2 weeks of TestFlight.

| Format | Assumed eCPM (EUR) | Range | Notes |
|--------|--------------------|-------|-------|
| Interstitial, personalised | 4 | 2-7 | small LV inventory, few local advertisers |
| Interstitial, non-personalised | 2 | 1-3 | most EU users after ATT decline |
| Rewarded video | 8 | 4-14 | best format, low volume |
| Banner | 0.4 | 0.2-0.8 | probably not worth the visual cost |
| Blended interstitial (30% personalised) | ~2.6 | | used in the model below |

## Premium ("Uzmini Cenu Plus"), via RevenueCat

- €2.99/month or €14.99/year, 7-day trial on both.
- No ads, unlimited duels, streak stats, category stats ("you overprice
  Purvciems by 12%"), custom room settings, premium badge on leaderboards,
  hints without watching an ad.
- Expect 1-3% conversion of MAU. At 5k MAU that is pocket money, so the
  point is covering costs and proving the model, not profit.

### RevenueCat configuration

| Item | Value |
|------|-------|
| RevenueCat project | `uzmini-cenu` |
| Entitlement | `plus` |
| Offering (default) | `default` with packages `$rc_monthly`, `$rc_annual` |
| App Store product id, monthly | `lv.uzminicenu.plus.monthly` |
| App Store product id, annual | `lv.uzminicenu.plus.annual` |
| Subscription group | `Uzmini Cenu Plus` |
| Introductory offer | 7-day free trial on both products, one per Apple ID (Apple enforces per subscription group) |
| Future Android products | `plus_monthly`, `plus_annual` (Google naming), same entitlement |
| Webhook | RevenueCat → Supabase Edge Function `rc-webhook` → sets `profiles.is_premium` and `premium_until`; client also reads `customerInfo.entitlements.active.plus` locally so the UI does not wait on the webhook |
| Paywall trigger events | `paywall_shown` with `source` = `interstitial_x`, `duel_cap`, `settings`, `hint`, `onboarding_skip` |

### Trial rules

- Trial is offered on the paywall as the primary CTA ("Izmēģināt 7 dienas
  bez maksas"). Price after trial shown in the same visual block, not in a
  footnote (App Store guideline 3.1.2 and EU consumer law).
- No trial for users who already had one on that Apple ID; RevenueCat
  reports `eligibility`, and the button text switches to "Abonēt".
- Trial cancellation is handled by Apple; we do nothing special. Premium
  features stop at trial end unless converted.
- No "trial ends soon" push in v1; Apple sends its own reminder.
- Trial start counts as a conversion event `trial_started`; paid conversion
  is `trial_converted` from the webhook `RENEWAL` after trial.
- Do not gate the daily challenge, share grid, or first 3 duels behind the
  trial. Trials should be started by people who already like the game.

### Paywall copy

Layout: hero line, three benefit rows with icons, two price cards with
annual pre-selected and a "save 58%" badge, primary button, restore link,
legal line.

Latvian:

```
Uzmini Cenu Plus
Spēlē bez reklāmām. Izsauc draugus bez limita.

✓ Nekādu reklāmu, arī brīvajā spēlē
✓ Neierobežoti dueļi ar draugiem
✓ Tava statistika: kurās kategorijās un rajonos tu trāpi labāk
✓ Padomi bez reklāmu skatīšanās
✓ Plus nozīmīte līderu tabulā

[ Gadā  €14,99 / gadā  ·  €1,25 mēnesī  ·  Ietaupi 58% ]
[ Mēnesī  €2,99 / mēnesī ]

[ Izmēģināt 7 dienas bez maksas ]
Pēc izmēģinājuma €14,99 gadā. Atcelt var jebkurā brīdī iestatījumos.

Atjaunot pirkumu · Lietošanas noteikumi · Privātuma politika
```

English:

```
Uzmini Cenu Plus
Play without ads. Challenge friends without limits.

✓ No ads, not even in free play
✓ Unlimited duels with friends
✓ Your stats: which categories and districts you read best
✓ Hints without watching ads
✓ Plus badge on the leaderboard

[ Yearly  €14.99 / year  ·  €1.25 a month  ·  Save 58% ]
[ Monthly  €2.99 / month ]

[ Try 7 days free ]
Then €14.99 per year. Cancel anytime in Settings.

Restore purchase · Terms of Use · Privacy Policy
```

Russian version to be produced from the Latvian copy in Phase 4 (P4.3).

## Revenue model

Assumptions (all rough, adjust after beta):
- DAU / MAU = 20%.
- 1.4 sessions per DAU per day; 60% of sessions include solo play averaging
  8 rounds → 1.6 interstitials per solo session → ~1.35 interstitials per
  DAU-day.
- Rewarded video: 0.15 views per DAU-day.
- Blended interstitial eCPM €2.6, rewarded €8, no banner.
- Premium: 1.5% of MAU are paying subscribers at any time; 60% annual, 40%
  monthly. Apple Small Business Program (15% commission) applies below
  $1M. Net per subscriber-month: monthly €2.99 × 0.85 = €2.54, annual
  €14.99 × 0.85 / 12 = €1.06. Blended ≈ €1.65. Latvian VAT (21%) is
  handled by Apple and is already inside the shelf price, so net is lower
  still: use €1.40 blended to be safe.
- Costs: Apple Developer €8.25/mo, domain €1/mo, Fly.io scraper €5/mo,
  Supabase free tier until ~5k MAU then Pro €25/mo, RevenueCat free below
  $2.5k MTR, PostHog and Sentry free tiers, Expo free tier for builds
  (may need the €19 plan if build minutes run out).

| | 1k MAU | 5k MAU | 20k MAU |
|--|--------|--------|---------|
| DAU | 200 | 1,000 | 4,000 |
| Interstitial impressions / month | 8,100 | 40,500 | 162,000 |
| Interstitial revenue | €21 | €105 | €421 |
| Rewarded views / month | 900 | 4,500 | 18,000 |
| Rewarded revenue | €7 | €36 | €144 |
| Ad revenue total | €28 | €141 | €565 |
| Paying subscribers (1.5%) | 15 | 75 | 300 |
| Premium net revenue | €21 | €105 | €420 |
| **Total net revenue / month** | **€49** | **€246** | **€985** |
| Costs / month | €15 | €40 | €60 |
| **Margin / month** | **€34** | **€206** | **€925** |

Reading: 1k MAU (the v1 success criterion) pays the bills and nothing
more. 5k MAU is a nice hobby. Real money in Latvia comes from sponsored
sets, not from the table above; one sponsored Thursday per month at
€300-500 would double the 5k-MAU line.

## Later revenue ideas

- Sponsored daily challenge: a real estate agency or car dealer sponsors
  Thursday's set with their listings, clearly labelled. This is the most
  realistic real money in Latvia and doubles as the partnership pitch to
  portals and agencies. Price anchor: €300-500 per set at 5k MAU.
- B2B: white-label quiz for a bank's mortgage campaign.

## Growth loop

1. Daily challenge result → share grid to Instagram stories / WhatsApp /
   Telegram with deep link.
2. Deep link opens App Store or the app on today's challenge.
3. New player plays 3 rounds without signup, then is asked to sign in to
   see the friend who invited them on the leaderboard.
4. Duel invite push brings lapsed players back.

## Referral mechanics (v1.1, P6.6)

Keep it simple and non-monetary so it does not trip App Store or gambling
rules.

- Every share link carries `?ref=<username>`. If the new install signs in
  within 7 days, `referrals(referrer, referee, created_at)` is written once
  per pair.
- Reward for the referrer: 7 days of Plus per successful referral, capped
  at 3 referrals (21 days) per calendar month; granted via RevenueCat
  promotional entitlement (`grantPromotionalEntitlement`, duration
  `weekly`) from the `rc-webhook` function.
- Reward for the referee: nothing extra beyond the friend auto-added
  (friendship request pre-accepted), which is what they actually want.
- Referral screen in the profile tab: "Uzaicini draugu, saņem 7 dienas
  Plus" with the share sheet. Shows count and days earned.
- Anti-abuse: referee must complete one daily challenge; same device id
  (expo-application `getIosIdForVendorAsync`) cannot count twice.
- Metric: `referral_completed` per week, share of new signups with a ref.

## Launch plan (Latvia only, organic)

### Pre-launch (weeks 9-11)

- TestFlight with 30 friends for 2 weeks, watch retention, fix scoring
  feel.
- Prepare press kit (P5.3), 6 TikTok clips recorded and edited, landing
  page live, App Store listing (14) approved.
- Warm up: post 3 "random" listing teasers on a personal Instagram / X
  during beta, no link yet.

### Launch week, day by day

Launch on a Tuesday so the App Store approval buffer lands on the weekend
before and the first daily challenge has a full week.

| Day | Action | Goal / metric |
|-----|--------|---------------|
| Mon | App approved and "Pending Developer Release"; schedule release for Tue 08:00 Riga. Send embargoed press email to 5 outlets with press kit and TestFlight link. Post "tomorrow" teaser story. | 5 press emails out |
| Tue | Release 08:00. Daily challenge #1 is a memorable set (curated by hand: one absurd `random` item). Post on r/latvia (text post with a screenshot of the grid, honest "I built this" tone), personal LinkedIn (works well in Latvia), Latvian X. TikTok clip #1. Reply to every comment. | 150 installs, 40 daily grids shared |
| Wed | TikTok clip #2 (car). Post in 2-3 Latvian Facebook groups where allowed (Rīgas dzīvokļi, auto groups) with the daily grid, not a link dump. Email 3 tech podcasts with a specific angle: "how I scrape SS politely". | 100 installs, first podcast reply |
| Thu | First "sponsored-style" set, unsponsored but themed (all Jūrmala houses) to demo the format; screenshot it and send to 2 agencies as a pitch. TikTok clip #3 (random item). | pitch emails out, D1 retention read from PostHog |
| Fri | Publish a short blog / LinkedIn post with launch numbers so far and the funniest guesses. Follow up press emails that got no reply. Push OTA fix for top 3 bugs via EAS Update. | 1 press mention |
| Sat | TikTok clip #4. Duel push campaign: in-app banner "Challenge a friend this weekend". | duel invites per DAU up |
| Sun | Rest. Weekly leaderboard closes; screenshot top 10 and post. Write week-1 retro in `docs/notes/launch-log.md`. | D7 cohort size known |
| Week 2 | Iterate on daily set curation; second press wave with real numbers ("1,000 Latvians guessed the price of this flat in Purvciems, average was 23% too high"). Data-driven angle is what Delfi / TVNET business desks actually pick up. | 1,000 installs by day 14 |

### Content marketing: TikTok / Reels formats

All built on the `random` category, 15-30 s, Latvian voice or captions,
Russian captions on every other clip. Film on the phone with the real app.

| Format | Script | Why it works |
|--------|--------|--------------|
| "Uzmini, cik maksā šis dīvāns" | show the item photo, 3 s countdown, reveal price with the in-app count-up, exaggerated reaction | the core game in 15 s; comments become guesses |
| Street guesses | ask 3 people in Old Riga / Origo to guess a listing on your phone, reveal | people watching people be wrong |
| Overpriced or fair? | one flat, show m2 and district only, "vai tas ir pārmaksāts?", reveal | taps into the national sport of complaining about Riga prices |
| Rīga vs Daugavpils | same flat size, two cities, guess the difference | regional rivalry, high share rate |
| 2008 Golf price ladder | 5 identical cars different years, guess the curve | car people argue in comments |
| Daily grid reaction | screen-record today's challenge, your reaction to each reveal, end on the grid | shows the share loop, drives same-day installs |
| Grandmother's price | ask an older relative to guess a 1990s-era item; reveal what people ask for it now on SS | nostalgia plus comedy, very shareable |
| Duet challenge | post a listing, invite duets with guesses, post the reveal next day | UGC without user-generated listings |

Cadence: 3 clips per week for the first month, then 1-2. Repost the best
ones as Instagram Reels and YouTube Shorts. Always attribute the portal
on screen.

### Press list categories

| Category | Targets | Angle |
|----------|---------|-------|
| National news portals, tech / business desks | Delfi (Tehnoloģijas, Bizness), TVNET (Tehnoloģijas), LSM.lv (Ekonomika, Tehnoloģijas), Apollo.lv | "Latvian dev builds GeoGuessr for SS.com prices"; later the data angle (how wrong Latvians are about flat prices) |
| Business press | Dienas Bizness, Forbes Latvia (baltic edition), Bizness.lv | market-calibration angle, sponsored-set model, real estate agencies as customers |
| Startup ecosystem | Labs of Latvia, LIAA / Magnetic Latvia newsletters, TechChill community, Startin.lv | solo indie story, no-Mac EAS build story |
| Tech podcasts and YouTube | Latvian tech podcasts (search current lineup at launch: e.g. "Digitālās brokastis", "Pieci.lv" tech segments, TechChill podcast, Latvian dev community podcasts on Spotify), Russian-language Riga tech channels | 30-minute conversation about scraping ethics, Supabase, indie economics |
| Real estate and auto media | Varianti.lv, City24 blog, Auto Bild Latvija, Kasjauns auto section | category-specific: "how well do you know the Riga flat market" |
| Russian-language Latvian media | rus.delfi.lv, rus.tvnet.lv, rus.lsm.lv, Mixnews | same story in Russian, separate email |
| Reddit / communities | r/latvia, r/Riga, Latvian Discord servers, Facebook groups (dzīvokļi, auto) | honest maker post, not an ad |

Rules: one journalist per outlet, personal email, 4 sentences, press kit
link, offer of an interview and of raw anonymised guess data for a story.
Never send the same text to two people at the same outlet.

## ASO keywords

App Store keyword field is 100 characters, comma separated, no spaces. App
name and subtitle words are indexed automatically, so do not repeat them.
Localise the listing for Latvian (primary), Russian, and English (UK).

| Locale | Keyword field (≤100 chars) | Notes |
|--------|----------------------------|-------|
| lv | `cena,dzīvoklis,dzīvokļi,auto,mašīna,māja,sludinājumi,spēle,viktorīna,ikdienas,izaicinājums,rīga,ss` | "ss" as a keyword is a search term, not branding; the lawyer confirms in P0.6, else drop |
| ru | `цена,угадай,квартира,квартиры,машина,авто,дом,объявления,игра,викторина,рига,латвия,ежедневно` | Russian storefront users in LV search in Russian |
| en | `price,guess,quiz,daily,puzzle,flat,apartment,car,house,latvia,riga,real estate,wordle,geoguessr` | competitor names in keywords are allowed if not in the title; monitor for rejection |

Title / subtitle combinations are in 14-app-store-listing.

## Metrics to track (PostHog)

- D1 / D7 retention of daily-challenge players.
- Share button tap rate on the daily result screen.
- Rounds per session, sessions per day.
- Duel invite → accept rate, time to accept.
- Premium paywall view → trial start → paid conversion, by `source`.
- Ad impressions per DAU, ad fill rate, ATT opt-in rate.
- Referral completed per week (v1.1).
