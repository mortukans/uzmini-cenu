# 02 Game design

Full game design document. Screen-level detail lives in
[11-screens-ux](11-screens-ux.md); data rules in [03-data-pipeline](03-data-pipeline.md);
multiplayer protocol in [06-multiplayer](06-multiplayer.md).

## 1. Core round

1. Show listing: photo carousel (1-5 photos), category, location (district or
   town), 2-4 key attributes (m2, rooms, floor / year, mileage, engine).
   Title and description hidden by default because they often contain the
   price.
2. Player enters a guess in EUR with a numeric pad and quick +/- steps
   (+1k, +10k for property; +100, +500 for cars; +1, +10 for items).
3. Reveal: actual asking price, error %, points, "open listing" button.
4. Next round.

A round is the same component in every mode (`play/[sessionId]`); modes only
differ in where listings come from, whether there is a timer, and what happens
after the reveal.

### 1.1 Round state machine

```
                 ┌──────────┐  prefetch ok   ┌─────────┐  first photo cached  ┌──────────┐
  session start ─▶ LOADING  ├───────────────▶│ STAGED  ├─────────────────────▶│ GUESSING │
                 └────┬─────┘                └─────────┘                      └────┬─────┘
                      │ network error / empty pool                                 │ submit (guess ≥ 1)
                      ▼                                                            ▼
                 ┌──────────┐                                                 ┌────────────┐
                 │  ERROR   │◀──────────── RPC fails, retry ×3 ───────────────┤ SUBMITTING │
                 └──────────┘                                                 └────┬───────┘
                                                                                   │ price + score
                    duel/room only: both/all guesses in, or deadline               ▼
                 ┌────────────────┐◀──────────────────────────────────────────┌────────────┐
                 │ WAITING_OTHERS │─────────────────────────────────────────▶ │ REVEALING  │ (count-up animation, 1.2 s)
                 └────────────────┘                                          └────┬───────┘
                                                                                   │ animation done / tap to skip
                                                                                   ▼
                                                                             ┌────────────┐  next    ┌──────────┐
                                                                             │  REVEALED  ├─────────▶│ LOADING  │ (next round, usually instant: prefetched)
                                                                             └────┬───────┘          └──────────┘
                                                                                  │ last round of session / streak broken
                                                                                  ▼
                                                                             ┌────────────┐
                                                                             │  SUMMARY   │
                                                                             └────────────┘
```

| State | Entered when | UI | Exits |
|-------|--------------|----|-------|
| `LOADING` | session start, or after `REVEALED` when the next round is not prefetched | skeleton card, no input | `STAGED` when listing metadata present; `ERROR` after 3 failed RPC calls or empty pool |
| `STAGED` | metadata present, first photo not yet cached | skeleton photo, attributes visible, input disabled | `GUESSING` when first photo cached (or 2 s timeout: show placeholder and continue) |
| `GUESSING` | photo shown | full input, timer (duel/room) | `SUBMITTING` on submit; in timed modes, auto-submit current value (or 0 = no guess) at deadline |
| `SUBMITTING` | guess sent via `submit_guess` / `submit_daily` | input locked, spinner on button | `REVEALING` on success (solo); `WAITING_OTHERS` (duel/room); `ERROR` on failure, guess kept in local state for retry |
| `WAITING_OTHERS` | duel/room: own guess accepted, others not in | "Waiting for X…" with remaining timer, own guess shown | `REVEALING` when server row shows all guesses for the round, or deadline passed |
| `REVEALING` | price known | count-up of price, then score pop, grid tile colour | `REVEALED` after animation or tap |
| `REVEALED` | animation done | price, error %, points, attributes incl. previously hidden title, "open listing", "next" | `LOADING` (next), `SUMMARY` (end), or streak-over branch |
| `SUMMARY` | session complete | mode-specific summary screen | back to home / play again |
| `ERROR` | any failure | inline error, retry button, "back" | previous state on retry success |

Rules:
- The reveal is always driven by the server response, never by client-side
  price knowledge (exception: offline solo, see 04).
- Prefetch: while in `GUESSING` for round n, fetch metadata and first photo
  for rounds n+1 and n+2. Solo free play keeps a pool of 10.
- Backgrounding the app in `GUESSING` (solo) keeps state. In duel/room the
  timer keeps running server-side; on foreground refetch the row.
- Every state change logs `round_state` in dev builds only.

### 1.2 Guess input UX

The input is a custom keypad, never the system keyboard (system keyboard
covers the photo and has inconsistent decimal handling).

```
┌───────────────────────────────┐
│          78 500 €             │  display, right aligned, monospace digits
│    ≈ 1 121 €/m²  (flats)      │  live derived value, small, grey
├───────────────────────────────┤
│  −10k   −1k   │   +1k   +10k  │  quick steps (category-specific)
├───────────────────────────────┤
│    1      2      3            │
│    4      5      6            │
│    7      8      9            │
│   000     0      ⌫            │
├───────────────────────────────┤
│ [        Uzmini!  (submit)   ]│  disabled until value ≥ 1
└───────────────────────────────┘
```

| Category | Quick steps | Typical range | Max digits |
|----------|-------------|---------------|-----------|
| flats | −10k, −1k, +1k, +10k | 15k - 500k | 7 |
| houses | −10k, −1k, +1k, +10k | 20k - 1M | 7 |
| land | −5k, −1k, +1k, +5k | 2k - 300k | 7 |
| cars | −500, −100, +100, +500 | 300 - 60k | 6 |
| random | −10, −1, +1, +10 | 1 - 5k | 5 |

Behaviour:
- Digits append; `000` appends three zeros (disabled if it would exceed max
  digits); `⌫` removes the last digit; long-press `⌫` clears.
- Quick steps add/subtract and clamp to `[0, 10^maxDigits - 1]`. Long-press
  repeats every 120 ms. A step from an empty field starts from 0.
- Value 0 or empty: submit disabled, display shows `— €`.
- Leading zeros are dropped. No decimals anywhere; prices are integers.
- Swipe down on the keypad area collapses it to reveal the full photo;
  tapping the display reopens it. The keypad is never covered by anything.
- After the first round in a session the keypad remembers nothing: every
  round starts empty (tested: pre-filling with the last guess anchors people).
- Haptic tick on each key (light impact), heavier on submit.

EUR formatting (lv, ru): thin-space thousands separator, space, euro sign:
`78 500 €`, `4 200 €`, `35 €`. English UI: `€78,500`. The formatter is one
function `formatEur(n, locale)` used everywhere including share text.
Derived values: flats and houses show live `€/m²`, cars show nothing, land
shows `€/ha`. In lists and summaries prices over 1M abbreviate: `1,2 M €`.

## 2. Scoring

Points per round, 0-1000, based on relative error:

```
err = |guess - price| / price
score = round(1000 * exp(-k * err))      k = 8
```

| error | score | | error | score |
|-------|-------|-|-------|-------|
| 0% | 1000 | | 15% | 301 |
| 1% | 923 | | 20% | 202 |
| 2% | 852 | | 25% | 135 |
| 3% | 787 | | 30% | 91 |
| 5% | 670 | | 40% | 41 |
| 7% | 571 | | 50% | 18 |
| 10% | 449 | | ≥ 100% | 0 |

Same formula for every category so scores are comparable. Tune k in playtest.
Alternative Housle-style "win within X%" is used only in Streak mode.

### 2.1 Worked examples

| Category | Listing | Price | Guess | err | Score | Grid tile |
|----------|---------|-------|-------|-----|-------|-----------|
| flats | Purvciems, 3 rooms, 65 m², 5/9, 602. sērija | 78 500 € | 72 000 € | 8.3% | 516 | 🟩 |
| flats | Centrs, 2 rooms, 54 m², 3/5, pirmskara | 129 000 € | 95 000 € | 26.4% | 121 | 🟥 |
| houses | Mārupe, 180 m², 1 200 m² land, 2008 | 245 000 € | 220 000 € | 10.2% | 442 | 🟨 |
| houses | Jūrmala, Dubulti, 320 m², 1 900 m² land | 650 000 € | 1 200 000 € | 84.6% | 1 | 🟥 |
| cars | VW Golf 2008, 1.9 D, manuāla, 245 000 km | 4 200 € | 4 500 € | 7.1% | 565 | 🟩 |
| cars | BMW X5 2019, 3.0 D, automāts, 98 000 km | 46 900 € | 39 000 € | 16.8% | 260 | 🟨 |
| random | Dīvāns, lietots, Rīga | 35 € | 20 € | 42.9% | 32 | 🟥 |
| random | Dīvāns, lietots, Rīga | 35 € | 60 € | 71.4% | 3 | 🟥 |
| random | Nokia 3310, lietots | 15 € | 15 € | 0% | 1000 | 🟩 |

Observations to carry into playtest:
- Error is relative to the real price, so overshooting by 2× is 100% error
  (0 points) but undershooting can never exceed 100%. That is asymmetric but
  intuitive ("you said double"). If playtesters find it harsh, the candidate
  fix is `err = |ln(guess / price)|` with k ≈ 6, which is symmetric in ratio.
  Decide in Phase 1, do not ship both.
- The `random` category has tiny prices where a 15 € swing is 40%. It is
  designed to be chaotic; the daily set carries only one random item so it
  cannot dominate the total.
- Grid tile colours: 🟩 err ≤ 10% (score ≥ 449), 🟨 10% < err ≤ 25%
  (135 ≤ score < 449), 🟥 otherwise. Colour is derived from `err`, not from
  the score, so hint penalties never change the colour.

### 2.2 Session and streak scoring

- Free play session: sum of 10 rounds, max 10 000. Shown as running total
  and as "average per round" on the summary.
- Daily: sum of 5 rounds, max 5 000.
- Duel: sum of 5 rounds per player; higher total wins; equal totals are a
  draw (no tie-break, draws are fine in a 1v1).
- Room: sum of 5 or 10 rounds; podium sorted by total, tie-break by number
  of 🟩 tiles, then by earliest final guess timestamp.

## 3. Modes

### 3.1 Solo: Free play
- Choose category (or "all"), region filter (Riga / Riga region / Latvia).
  For flats the Riga filter additionally allows picking districts.
- Endless rounds, running score shown, session summary after 10 rounds.
- "Skip" is allowed (max 2 per session): the round is dropped, not scored,
  and does not count towards the 10. Skips are logged to spot bad listings.
- No account needed. Anonymous guesses are written with `user_id = null`.
- Interstitial ad after rounds 5 and 10 for free users (see 07).

### 3.2 Solo: Streak
- Rule: guess must be within 15% of the asking price. One miss ends the
  streak. No points, only the streak length.
- v1 ships "within 15%". "Higher or lower" (two listings side by side, tap
  the pricier one) is a v1.1 variant using the same pool.
- Best streak stored per category and for "all". Current streak survives app
  restarts (persisted locally; server-side in `guesses` with
  `mode = 'streak'`, `context_id` = streak session id).
- Every 5 consecutive hits award one hint token (max 3 held). Tokens are
  usable in free play and streak, not in daily/duel/room.
- Streak-over screen shows the miss, the price, best streak, and "try again"
  which starts a new streak in the same category immediately.
- Anonymous players keep local bests; signing in migrates them.

### 3.3 Daily challenge
- Same 5 listings for everyone, seeded per date, mixed categories
  (2 flats, 1 house, 1 car, 1 random, see 03).
- One attempt per day per user. Anonymous users can play (result stored
  locally, keyed by device) but appear on no leaderboard; signing in later
  the same day uploads the local result via `submit_daily` if none exists.
- No timer, no hints, no ads inside. The 5 rounds must be completed in one
  sitting; leaving mid-way keeps the completed rounds and resumes on the
  next open (state persisted locally with round tokens).
- Day boundary: **00:00 Europe/Riga** (EET/EEST, DST handled by the tz
  database, never hard-coded +2/+3). Definitions:
  - `daily_no = days_between('2026-XX-XX' launch day, today_riga) + 1`.
    Launch day is fixed at launch and stored as a constant in the app and
    in `build_daily`.
  - The server is authoritative for "today": `get_daily()` returns
    `{ day, daily_no, seconds_until_next, already_played }`. The client
    never trusts device date for eligibility. Device date is only used to
    render the local countdown, corrected by `seconds_until_next`.
  - `build_daily` runs at 23:30 Europe/Riga for the next day so the set
    exists before midnight. A missing set is a Sentry alert and the client
    shows "Šodienas izaicinājums vēl gatavojas".
  - Weekly leaderboards use ISO weeks, Monday 00:00 Europe/Riga.
- Result screen produces a share text like Wordle:
  ```
  Uzmini Cenu #37  3,410 / 5,000
  🟩🟩🟨🟥🟩
  ```
  Green within 10%, yellow within 25%, red otherwise.
- Global and friends leaderboard for the day and the week.
- This is the growth engine. Ship it in v1.

#### Share text, exact format

Three lines, plain text, no markdown. Line 1 is locale-formatted, line 2 is
the grid, line 3 is the deep link. The `#N` and the grid are locale
independent so screenshots are comparable across languages.

```
lv:  Uzmini Cenu #37 · 3 410 / 5 000
     🟩🟩🟨🟥🟩
     uzminicenu.lv/d/37

ru:  Uzmini Cenu #37 · 3 410 / 5 000
     🟩🟩🟨🟥🟩
     uzminicenu.lv/d/37

en:  Uzmini Cenu #37 · 3,410 / 5,000
     🟩🟩🟨🟥🟩
     uzminicenu.lv/d/37
```

- Separator between title and score is ` · ` (space, U+00B7, space).
- Streak suffix on line 1 when the player has a daily streak ≥ 2:
  `Uzmini Cenu #37 · 3 410 / 5 000 · 🔥5` (5 consecutive days played).
- The link `uzminicenu.lv/d/37` is a universal link. It opens the app on the
  daily intro if installed; otherwise the landing page shows a blurred first
  photo of round 1 and the App Store badge (see 10-open-questions #9).
- Sponsored sets (later) add a fourth line `Sponsorē: <name>` only if the
  sponsor contract requires it; default is no fourth line.
- The share sheet uses the native iOS share sheet with the text only (no
  image in v1). Copy-to-clipboard is a secondary button.

### 3.4 Duel (1v1)
- Pick a friend, they receive a push: "Mārtiņš challenges you. Play?"
- Both play the same 5 rounds. Sync per round (see 06-multiplayer). If the
  friend does not accept within 24 h the duel runs async: each plays when they
  can, result revealed when both finished.
- 30 s per round in sync mode; no timer in async mode.
- Reveal shows both guesses on a horizontal bar around the real price.
- Win/loss record per friend pair, shown on the friend row.
- Free users: 3 duel invites per day (accepting is always free).

### 3.5 Party room
- Host creates room, gets a 4-letter code / share link. Up to 10 players.
- Host picks category and round count (5 / 10). Rounds advance when everyone
  has guessed or after a 30 s timer.
- Live scoreboard between rounds. End screen with podium.
- v1.1, after duel works.

## 4. Categories

| Key | Source | Attributes shown | Notes |
|-----|--------|------------------|-------|
| flats | SS.com real-estate/flats, City24 | district, rooms, m2, floor/total, series (Hruščovka, jaunais projekts) | biggest category |
| houses | SS.com houses, City24 | town, m2, land m2, year | |
| cars | SS.com transport/cars | make, model, year, km, engine, gearbox | huge volume, very shareable |
| random | SS.com misc: furniture, electronics, collectibles | title (sanitised), condition | comedy value |
| land | SS.com land plots | town, ha | maybe later |

Filter rules per category are in 03-data-pipeline.

### 4.1 Attribute display per category

"SS field" is the label on the SS.com detail page. "Shown" = visible during
the guess. "After reveal" = shown only on the reveal screen. "Never" = not
stored or stored but not displayed.

**Flats** (`attributes` jsonb keys in code font)

| SS field | Key | Shown | Format | Notes |
|----------|-----|-------|--------|-------|
| Pilsēta / Rajons | `location` | yes | "Purvciems", "Jūrmala, Dubulti" | header, big |
| Iela | — | never | | street would let people open the listing before guessing |
| Istabas | `rooms` | yes | "3 ist." | |
| Platība | `m2` | yes | "65 m²" | |
| Stāvs | `floor`, `floors_total` | yes | "5/9" | lift flag hidden |
| Sērija | `series` | yes | "602. sērija", "Jaun.", "Hrušč.", "Pirmskara", "Renov." | biggest single signal for Riga; shown as a tag |
| Mājas tips | `building` | after reveal | "Paneļu", "Ķieģeļu", "Koka" | |
| Ērtības | `amenities` | never | | text often contains price / "izdevīgi" |
| Darījuma veids | — | never | | filter only: Pārdod |

**Houses**

| SS field | Key | Shown | Format |
|----------|-----|-------|--------|
| Pilsēta / Novads / Pagasts | `location` | yes | "Mārupe", "Ogres nov., Ikšķile" |
| Platība | `m2` | yes | "180 m²" |
| Zemes platība | `land_m2` | yes | "1 200 m²" (≥ 1 ha shown as "1,5 ha") |
| Stāvu skaits | `floors` | yes | "2 stāvi" |
| Istabas | `rooms` | after reveal | "5 ist." |
| Ērtības | — | never | |
| Year (parsed from description when present) | `year` | yes if present | "2008" |

**Cars**

| SS field | Key | Shown | Format |
|----------|-----|-------|--------|
| Marka / Modelis | `make`, `model` | yes | "Volkswagen Golf" header |
| Izlaiduma gads | `year` | yes | "2008" |
| Motors | `engine` | yes | "1.9 D", "2.0 B", "Hibrīds", "Elektro" |
| Ātr.kārba | `gearbox` | yes | "Manuāla" / "Automāts" |
| Nobraukums, km | `km` | yes | "245 000 km" |
| Krāsa | `color` | after reveal | |
| Virsbūves tips | `body` | after reveal | "Universāls" |
| Tehniskā apskate | `inspection` | after reveal | "līdz 05.2027" (strong price signal; hidden during guess) |
| Pilsēta | `location` | yes, small | |

**Random**

| SS field | Key | Shown | Format |
|----------|-----|-------|--------|
| Category path | `path` | yes | "Mēbeles › Dīvāni" |
| Stāvoklis | `condition` | yes if present | "Jauns" / "Lietots" |
| Pilsēta | `location` | yes, small | |
| Title | `title_hint` | hint only / after reveal | scrubbed of digits + € |
| Description | — | never | |

**Land** (later)

| SS field | Key | Shown |
|----------|-----|-------|
| Pilsēta / Pagasts | `location` | yes |
| Platība | `ha` | yes, "0,35 ha" (< 1 ha also as m²) |
| Zemes lietošanas mērķis | `purpose` | yes: "Apbūve" / "Lauksaimniecība" |

Every round footer shows `Avots: SS.com` (or City24) with the portal logo
once permitted, and the reveal has "Atvērt sludinājumu" opening `source_url`
in an in-app browser.

## 5. Hints (optional, premium or streak reward)

- Reveal listing title.
- Reveal price range bracket (e.g. 40-80k).
- Reveal 1 more photo.
Hints cost a percentage of the round's max score.

### 5.1 Details

| Hint | Effect | Penalty (multiplier on score) | Available in |
|------|--------|-------------------------------|--------------|
| Title | shows `title_hint` under the attributes | ×0.85 | free play, streak |
| Bracket | shows the price ladder bucket containing the price | ×0.70 | free play, streak |
| Extra photo | unlocks photos 4-5 when the round was limited to 3 | ×0.90 | free play, streak |

- `score = round(1000 * exp(-k * err) * Π penalties)`. Penalties multiply
  (title + bracket = ×0.595). In streak mode the 15% rule is unaffected;
  the penalty only matters for stats.
- Not available in daily, duel, room. Fairness beats monetization there.
- Cost to the player: 1 hint token (earned in streak, 3 max held), or a
  rewarded video (free users, max 5/day), or free for premium.
- Bracket ladder (fixed, so the bucket cannot be inverted to the exact
  price):
  - property: 10-20k, 20-40k, 40-80k, 80-160k, 160-320k, 320-640k, 640k+
  - cars: 0,5-1k, 1-2k, 2-4k, 4-8k, 8-16k, 16-32k, 32-64k, 64k+
  - random: 0-10, 10-25, 25-50, 50-100, 100-250, 250-500, 500-1k, 1k+
- Hint use is recorded per guess (`guesses.hints text[]` — add in 05 when
  hints ship; currently v1.1 per 10-open-questions #7).

## 6. Leaderboards

| Board | Scope | Period | Value | Tie-break |
|-------|-------|--------|-------|-----------|
| Daily | global, friends | one day | `daily_results.total` | more 🟩 in grid → earlier submission → username A-Z |
| Weekly | global, friends | ISO week, Europe/Riga | sum of daily totals, missing days = 0 | more days played → more 🟩 → earlier last submission |
| All-time | global, friends | lifetime | sum of daily totals | days played → 🟩 count |
| Streak best | global, friends | lifetime | best streak per category | earlier achieved |
| Duel record | per friend pair | lifetime | W-L-D | — |

Rules:
- Only signed-in users appear. Anonymous players see the board with a
  "sign in to appear" banner and their own would-be rank.
- "Friends" = accepted friendships + self. Self is always highlighted and
  pinned at the bottom if outside the top 50.
- Global boards show top 100 plus the player's own row. Ranks are dense
  (ties share a rank: 1, 2, 2, 4).
- Usernames go through a profanity list at creation (lv, ru, en); a report
  button on any row hides the user locally and flags for review.
- Weekly resets Monday 00:00 Europe/Riga; the previous week's top 3 get a
  small badge on their profile for the next week.
- Tie-break on submission time requires `submitted_at` on `daily_results`
  (note for 05-data-model).
- Premium badge is decorative only, never affects rank.

## 7. Difficulty and anti-frustration

- **Curated pool.** Free play draws from `quality >= 0` only. Listings
  flagged by 3+ skips or reports drop to `quality = -1` and leave the pool
  automatically.
- **Outliers.** Pipeline caps per category (03). Additionally rounds
  exclude the top and bottom 2% of active prices per category/region, so a
  600 000 € Purvciems flat (typo or scam) never appears. Daily sets are
  human-previewed the evening before.
- **First-session ramp.** The first 3 onboarding rounds are hand-picked
  "typical" listings (`quality = 2`, one flat, one car, one random) so the
  first score is not 0.
- **Score floor feel.** 0-point rounds are common in `random`. The reveal
  copy softens them: "Trāpīji uz 80% garām, bet tāds ir SS." Never show
  negative language.
- **Context after reveal.** Flats/houses show €/m² at reveal; cars show the
  listing year. The player learns something even when wrong (secondary
  audience: real flat hunters).
- **Streak mode difficulty** is category-dependent by nature (cars are
  easier to hit within 15% than random). Bests are stored per category so
  numbers stay comparable.
- **Timers.** None in solo/daily. 30 s in duel/room with a visible ring and
  a haptic at 5 s. An unsubmitted guess at deadline scores 0 and shows
  "Laiks!" rather than an error.
- **No punishment for leaving.** Free play has no lives; closing the app
  loses nothing. Daily resumes. Duel/room state is server-side.

## 8. Edge cases

| Case | Handling |
|------|----------|
| Listing has 1 photo | Pipeline rejects for flats/houses/cars (min 2). `random` allows 1; the carousel hides dots and the "extra photo" hint is disabled |
| Photo fails to load (hotlink blocked, 404) | 2 s timeout → try the next photo → placeholder with category icon; round still playable; `photo_failed` event with listing id; 5 fails in 24 h → listing `status = expired` |
| Listing expired between fetch and guess | Irrelevant: price is checked against the round token's snapshot; reveal shows "Sludinājums vairs nav aktīvs" instead of the open button |
| Price outlier slipped through | Score is still computed; reveal adds "Neparasta cena" tag; player can report; 3 reports auto-reject |
| Duplicate listing within a session | `get_rounds` excludes listing ids already served in the session (client passes `exclude[]`) and, for signed-in users, ids seen in the last 30 days |
| Guess exactly equals price | 1000 points, confetti, `perfect_guess` event; grid 🟩 |
| Guess submitted twice (double tap) | Button disables on first tap; server rejects a reused round token idempotently, returning the first result |
| Round token expired (>30 min) | Server returns `token_expired`; client discards the round, shows a toast, loads a new one. Daily tokens live 24 h |
| Device clock wrong | Daily eligibility uses server day; the countdown uses `seconds_until_next` |
| Daily set missing | "Gatavojas…" state with retry; alert to Sentry |
| Offline in solo | Prefetched rounds play with local scoring, banner "Bezsaistē: rezultāti netiek saglabāti" |
| Offline in daily/duel/room | Blocking sheet "Nav savienojuma" with retry; state is preserved |
| Opponent never answers (sync duel) | Round auto-reveals at deadline with opponent score 0 for that round; after 2 idle rounds the duel drops to async |
| Very long location string | Ellipsis after 28 chars, full text on long-press |
| Price ≥ 1 000 000 € | Count-up animation speeds up (fixed 1.2 s duration regardless of magnitude); display uses full digits |
| VoiceOver user | Keypad keys have labels; the count-up posts a single accessibility announcement with the final price and score |

## 9. Accessibility

- Minimum tap target 44×44 pt; keypad keys 64 pt tall.
- Text scales with Dynamic Type up to the XXL step; the keypad has a fixed
  size and the photo shrinks instead.
- Colour is never the only channel: grid tiles also carry a glyph in
  accessible mode (🟩 → ✓, 🟨 → ~, 🟥 → ✗) and the reveal states the error
  percentage in text.
- VoiceOver: photo carousel announces "Foto 1 no 3"; attributes are one
  grouped element ("3 istabas, 65 kvadrātmetri, 5. stāvs no 9"); the timer
  announces at 10 s and 5 s.
- Reduce Motion: count-up and confetti are replaced by a fade.
- Contrast ≥ 4.5:1 for all text; the score colour scale (red → green) has
  a dark and light variant tested with a contrast checker.
- Left-handed mode toggle mirrors the quick-step row (nice-to-have).

## 10. Haptics and sound

| Moment | Haptic (expo-haptics) | Sound (default off, toggle in settings) |
|--------|----------------------|------------------------------------------|
| Keypad key | `impactLight` | soft click |
| Quick step | `selection` | tick |
| Submit | `impactMedium` | whoosh |
| Count-up ticking | none (too much) | rising ticker, 1.2 s |
| Score ≥ 800 | `notificationSuccess` | chime |
| Score < 100 | `notificationWarning` | short "womp" |
| Perfect 1000 | `notificationSuccess` ×2 + confetti | fanfare |
| Timer 5 s left | `impactHeavy` once | tick-tock |
| Streak broken | `notificationError` | glass break, short |
| Duel win | `notificationSuccess` | fanfare |

Sound respects the iOS silent switch (`playsInSilentModeIOS: false`).
Haptics have their own toggle. Both default: haptics on, sound off.

## 11. Onboarding

- 3 practice rounds before any sign-up prompt.
- Account (Sign in with Apple + anonymous) only when the player wants
  leaderboards, friends, or duels.
- Language is taken from the device (lv/ru/en, fallback lv) and can be
  changed on the first screen and in settings.

## 12. UX rules

- One-thumb portrait UI. Numeric input never hidden behind the keyboard.
- Photos load progressively; never show a round until first photo is cached.
- Round reveal must feel like a slot-machine stop: count-up animation of the
  real price, then the score.
- Latvian is the default UI language. Russian and English as options.
- Never show a listing's street, phone number, or seller name.
- Every price displayed is the asking price; copy says "prasa" / "просят" /
  "asking", never "vērts" / "worth".

## 13. Localisation: core strings

Keys live in `src/i18n/{lv,ru,en}.json`. ICU plural syntax for counts.
Latvian is the source language; RU/EN are translated from it.

| Key | lv | ru | en |
|-----|----|----|----|
| `home.play` | Spēlēt | Играть | Play |
| `home.daily` | Dienas izaicinājums | Задание дня | Daily challenge |
| `home.daily_done` | Šodien jau izspēlēts | Сегодня уже сыграно | Played today |
| `home.next_in` | Nākamais pēc {time} | Следующее через {time} | Next in {time} |
| `round.guess_cta` | Uzmini! | Угадать! | Guess! |
| `round.asking` | Prasa | Просят | Asking |
| `round.round_of` | {n}. kārta no {total} | Раунд {n} из {total} | Round {n} of {total} |
| `round.skip` | Izlaist | Пропустить | Skip |
| `round.time_up` | Laiks! | Время! | Time's up! |
| `reveal.your_guess` | Tavs minējums | Твой ответ | Your guess |
| `reveal.off_by` | Garām par {pct} % | Промах на {pct} % | Off by {pct}% |
| `reveal.points` | {n} punkti | {n} очков | {n} points |
| `reveal.perfect` | Precīzi! | Точно! | Spot on! |
| `reveal.open_listing` | Atvērt sludinājumu | Открыть объявление | Open listing |
| `reveal.next` | Nākamais | Дальше | Next |
| `reveal.source` | Avots: {source} | Источник: {source} | Source: {source} |
| `summary.total` | Kopā {n} / {max} | Итого {n} / {max} | Total {n} / {max} |
| `summary.play_again` | Spēlēt vēlreiz | Ещё раз | Play again |
| `daily.title` | Uzmini Cenu #{no} | Uzmini Cenu #{no} | Uzmini Cenu #{no} |
| `daily.share` | Dalīties | Поделиться | Share |
| `daily.copied` | Nokopēts | Скопировано | Copied |
| `daily.preparing` | Šodienas izaicinājums vēl gatavojas | Задание дня ещё готовится | Today's challenge is being prepared |
| `streak.current` | Sērija: {n} | Серия: {n} | Streak: {n} |
| `streak.best` | Labākā sērija: {n} | Лучшая серия: {n} | Best streak: {n} |
| `streak.over` | Sērija pārtrūka | Серия прервана | Streak over |
| `duel.invite_push` | {name} izaicina tevi. Spēlēsi? | {name} вызывает тебя. Сыграем? | {name} challenges you. Play? |
| `duel.waiting` | Gaidām {name}… | Ждём {name}… | Waiting for {name}… |
| `duel.you_win` | Tu uzvarēji! | Ты победил! | You win! |
| `duel.you_lose` | Zaudējums | Поражение | You lost |
| `duel.draw` | Neizšķirts | Ничья | Draw |
| `duel.rematch` | Revanšs | Реванш | Rematch |
| `leaderboard.title` | Līderu tabula | Таблица лидеров | Leaderboard |
| `leaderboard.sign_in_banner` | Pieraksties, lai parādītos tabulā | Войди, чтобы попасть в таблицу | Sign in to appear on the board |
| `auth.apple` | Pierakstīties ar Apple | Войти через Apple | Sign in with Apple |
| `auth.later` | Vēlāk | Позже | Later |
| `common.offline` | Nav savienojuma | Нет соединения | No connection |
| `common.retry` | Mēģināt vēlreiz | Повторить | Retry |
| `common.eur` | € | € | € |

Formatting rules per locale: lv/ru use a thin space thousands separator and
a comma decimal (`1,2 M €`); en uses a comma separator and a point decimal
(`€1.2M`). Dates: `dd.mm.yyyy` for lv/ru, `d MMM yyyy` for en. Plurals: lv
has a special case for numbers ending in 1 (except 11); ru has one/few/many;
use ICU so translators handle it.
