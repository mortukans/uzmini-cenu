# 11 Screens and UX

Screen-by-screen spec. Game rules are in [02-game-design](02-game-design.md);
this doc only says what is on each screen, how you get in and out, what the
empty/loading/error states look like, and which analytics events fire.

Conventions:
- Portrait only, one-thumb. Primary action is always the bottom-most
  full-width button. Secondary actions are text buttons above it or in the
  header.
- Every screen fires `screen_view {screen}` on focus (PostHog autocapture is
  off; events are explicit). Event names are `snake_case`; properties are
  listed in braces.
- Anonymous users can reach every screen; screens that need an account show
  a sign-in sheet inline instead of blocking navigation.

## 1. Navigation map (Expo Router)

```
app/
  _layout.tsx                    root stack, providers, deep-link handling
  onboarding.tsx                 first launch only (3 practice rounds)
  (tabs)/
    _layout.tsx                  bottom tabs: Sākums · Diena · Draugi · Profils
    index.tsx                    home
    daily.tsx                    daily intro (or result if played)
    friends.tsx                  friends list + duel history
    profile.tsx                  profile + settings entry
  play/
    setup.tsx                    category / region / mode picker (modal)
    [sessionId].tsx              round screen (all modes)
    summary/[sessionId].tsx      free play summary / streak over
  daily/
    result.tsx                   daily result + share
  leaderboard/
    index.tsx                    tabs: day / week / all · global / friends
  duel/
    invite.tsx                   pick friend, send (modal)
    [duelId].tsx                 duel lobby + round + waiting (one route, state-driven)
    [duelId]/result.tsx          duel result, rematch
  room/
    create.tsx                   modal
    [code].tsx                   lobby → rounds → podium (one route, state-driven)
  reveal/[roundId].tsx           modal over play/duel/room; transparent background
  settings/
    index.tsx
    language.tsx
    account.tsx                  delete account, sign out
  paywall.tsx                    modal (RevenueCat)
  sign-in.tsx                    modal sheet
```

Deep links (`uzminicenu://` and universal links on `uzminicenu.lv`):

| Link | Route | Behaviour |
|------|-------|-----------|
| `/d/37` | `(tabs)/daily` | opens today's intro; if #37 is not today, shows "this one is over" with today's set |
| `/duel/{id}` | `duel/[duelId]` | from push; if not signed in → sign-in sheet first, then the duel |
| `/r/KTRP` | `room/[code]` | joins lobby; prompts username if anonymous |
| `/u/{username}` | `friends` with add sheet | add friend from a shared profile link |

Tab bar is hidden on `play/*`, `duel/*`, `room/*`, `reveal/*`, `daily/result`.

## 2. Screen specs

### 2.1 Onboarding (`onboarding`)

| | |
|--|--|
| Purpose | Teach the loop in 3 real rounds without any sign-up. Set language. |
| Elements | Language chips (LV · RU · EN) on the first card; 3 practice rounds (hand-picked flat, car, random) using the regular round component with a coach overlay on round 1 ("Bīdi foto", "Ievadi cenu", "Uzmini!"); mini summary "Tu sāki ar {n} punktiem" |
| Primary | "Sākt" → home |
| Secondary | "Izlaist" (top right, from round 1) → home |
| In | first launch only (`onboarded` flag in AsyncStorage) |
| Out | home. Never shown again; replayable from settings |
| Loading | needs 3 listings from `get_rounds('onboarding')`; skeleton for max 3 s, then falls back to a bundled offline set of 3 listings shipped in the app |
| Error | offline → bundled set, no error shown |
| Events | `onboarding_start`, `onboarding_round {n, score}`, `onboarding_complete {total, skipped}`, `language_set {lang, source: 'onboarding'}` |

### 2.2 Home (`(tabs)/index`)

```
┌──────────────────────────────────┐
│ Uzmini Cenu            [avatar]  │
│                                  │
│ ┌──────────────────────────────┐ │
│ │ DIENAS IZAICINĀJUMS  #37     │ │
│ │ ░░░░ blurred 1st photo ░░░░  │ │
│ │ 5 kārtas · 2 flats 1 house…  │ │
│ │ [        Spēlēt šodien      ]│ │   ← or: "3 410 / 5 000 🟩🟩🟨🟥🟩 · Dalīties"
│ │ Nākamais pēc 14:22:05        │ │
│ └──────────────────────────────┘ │
│                                  │
│ ┌─────────────┐ ┌─────────────┐  │
│ │ Brīvā spēle │ │  Sērija     │  │
│ │ dzīvokļi…   │ │  labākā: 12 │  │
│ └─────────────┘ └─────────────┘  │
│ ┌─────────────┐ ┌─────────────┐  │
│ │  Duelis     │ │  Istaba     │  │   ← Istaba greyed "drīzumā" until v1.1
│ │ 2 gaida     │ │  KTRP       │  │
│ └─────────────┘ └─────────────┘  │
│                                  │
│ Draugi šodien                    │
│  1. Anna        4 120 🟩🟩🟩🟨🟩  │
│  2. Tu          3 410 🟩🟩🟨🟥🟩  │
│  → visa tabula                   │
├──────────────────────────────────┤
│  Sākums   Diena   Draugi  Profils│
└──────────────────────────────────┘
```

| | |
|--|--|
| Purpose | One tap to the daily, one tap to any mode. Show what friends did today. |
| Elements | Daily card (state: not played / played / preparing), 4 mode tiles, friends-today mini board (top 3 + self), pending duel badge on the Duel tile |
| Primary | Daily card button |
| Secondary | Mode tiles, avatar → profile, "visa tabula" → leaderboard |
| In | tab, app launch after onboarding, deep link fallback |
| Out | `daily`, `play/setup`, `play/[sessionId]` (streak starts directly in last category), `duel/invite`, `room/create`, `leaderboard`, `profile` |
| Loading | daily card skeleton; tiles render immediately from local state |
| Empty | friends board: "Pievieno draugus, lai redzētu viņu rezultātus" → friends tab; anonymous: "Pieraksties" banner instead of the board |
| Error | daily card: "Nevar ielādēt" + retry; rest of the screen works |
| Events | `home_daily_tap {state}`, `home_mode_tap {mode}`, `home_share_tap` (from played state), `home_leaderboard_tap` |

### 2.3 Category picker / play setup (`play/setup`, modal)

| | |
|--|--|
| Purpose | Choose mode (free / streak), category, region before a solo session. |
| Elements | Segmented control Brīvā spēle / Sērija; category grid (Dzīvokļi, Mājas, Auto, Random, Visi; Zeme greyed), region chips (Rīga / Rīgas reģ. / Latvija), district multiselect appears when flats + Rīga; best streak per category shown on tiles in streak mode; active listing count per selection ("~1 240 sludinājumi") |
| Primary | "Spēlēt" → `play/[sessionId]` |
| Secondary | close (X) |
| In | home mode tiles, summary "change category" |
| Out | round screen, or back |
| Loading | counts load async; button enabled without them |
| Empty | selection with < 50 active listings: button disabled, hint "Pārāk maz sludinājumu, izvēlies plašāku reģionu" |
| Error | counts fail silently; play still works |
| Events | `setup_open {mode}`, `setup_start {mode, category, region, districts_count}` |

### 2.4 Round (`play/[sessionId]`, also embedded in duel/room)

```
┌──────────────────────────────────┐
│ ✕   3. kārta no 10     1 450 p.  │   ← duel/room: timer ring instead of points
│ ┌──────────────────────────────┐ │
│ │                              │ │
│ │        [ photo 1/3 ]         │ │   ← swipe, dots, pinch to zoom
│ │                              │ │
│ │  ● ○ ○              SS.com   │ │
│ └──────────────────────────────┘ │
│ DZĪVOKLIS · Purvciems            │
│ 3 ist. · 65 m² · 5/9 · 602. sēr. │
│ 💡 Padoms                        │   ← hint button, only free/streak
├──────────────────────────────────┤
│              78 500 €            │
│           ≈ 1 208 €/m²           │
│  [−10k] [−1k]      [+1k] [+10k]  │
│     1        2        3          │
│     4        5        6          │
│     7        8        9          │
│    000       0        ⌫          │
│ [           Uzmini!             ]│
└──────────────────────────────────┘
```

| | |
|--|--|
| Purpose | The core loop. Identical layout in every mode. |
| Elements | Header (close, round counter, running total or timer ring), photo carousel with source tag, category + location line, attribute line, optional hint button, keypad block (see 02 §1.2), submit |
| Primary | "Uzmini!" |
| Secondary | close (confirm sheet in daily/duel/room: "Progress tiks saglabāts"), skip (free play only, max 2), hint (free/streak), photo tap → fullscreen viewer |
| In | setup, home streak tile, daily intro, duel accept, room start |
| Out | `reveal/[roundId]` (modal on top), summary, or back to the mode's entry screen |
| Loading | `LOADING`/`STAGED` states: photo shimmer, attributes visible early, keypad disabled |
| Empty | pool exhausted (rare): "Šai izvēlei sludinājumi beigušies" → setup |
| Error | submit fail: keep guess, inline "Nevar nosūtīt" + retry; token expired: toast + new listing |
| Events | `round_start {mode, category, listing_id, round_no}`, `round_photo_swipe {index}`, `round_hint_use {type}`, `round_skip`, `round_submit {guess, seconds_spent, steps_used, digits_typed}`, `photo_failed {listing_id, index}` |

Timer (duel/room): 30 s ring around the round counter, turns orange at 10 s,
red at 5 s with haptic. At 0 the current value auto-submits (0 if empty).

### 2.5 Reveal (`reveal/[roundId]`, modal)

```
┌──────────────────────────────────┐
│                                  │
│           Prasa                  │
│         78 500 €                 │   ← counts up over 1.2 s, then locks
│         1 208 €/m²               │
│                                  │
│  Tavs minējums   72 000 €        │
│  Garām par       8,3 %           │
│                                  │
│        ┌──────────┐              │
│        │   516    │  🟩          │   ← pops in after count-up
│        │  punkti  │              │
│        └──────────┘              │
│                                  │
│  ──────●────────▲────────────    │   ← bar: your guess (●) vs price (▲); duel adds opponent (◆)
│  60k                      100k   │
│                                  │
│  "3 istabu dzīvoklis Purvciemā,  │   ← title_hint now shown
│   602. sērija, renovēts"         │
│  Paneļu māja · Avots: SS.com     │
│                                  │
│  [ Atvērt sludinājumu ]  [Ziņot] │
│ [           Nākamais            ]│
└──────────────────────────────────┘
```

| | |
|--|--|
| Purpose | The payoff. Slot-machine count-up, score, learn the real price, link back. |
| Elements | Asking price count-up, derived value, your guess, error %, score card with grid tile, guess-vs-price bar (duel: both players; room: top 3 + you), revealed title and after-reveal attributes, source line, open listing, report, next |
| Primary | "Nākamais" (last round: "Rezultāts") |
| Secondary | open listing (in-app browser, `source_url`), report (sheet: wrong price / rent / spam / offensive), tap anywhere during count-up to skip animation |
| In | round submit |
| Out | next round, summary, daily result, duel result, room scoreboard |
| Loading | none; opened only with data. Duel `WAITING_OTHERS` renders this modal with the price hidden ("Gaidām Annu… 12 s") and the count-up starts when the row updates |
| Error | listing expired: open button replaced by "Sludinājums vairs nav aktīvs" |
| Events | `reveal_view {mode, score, err_pct, tile}`, `reveal_open_listing {listing_id}`, `reveal_report {listing_id, reason}`, `perfect_guess {listing_id}` |

### 2.6 Session summary / streak over (`play/summary/[sessionId]`)

| | |
|--|--|
| Purpose | Close a free-play session or a streak with a shareable number. |
| Elements | Free play: total / 10 000, average per round, 10 mini rows (thumbnail, your guess, price, score, tile), best round highlight, "you overprice by X%" bias line. Streak: big streak number, best streak, the listing that ended it with price vs guess |
| Primary | "Spēlēt vēlreiz" (same settings) |
| Secondary | "Mainīt kategoriju" → setup, "Dalīties" (text: `Brīvā spēle · Dzīvokļi Rīgā · 6 820 / 10 000`), home |
| In | round 10 reveal, streak miss reveal, close-with-confirm mid-session (shows partial) |
| Out | setup, round, home |
| Loading | none (local data) |
| Error | anonymous with sync failure: local summary still shows; badge "nesinhronizēts" |
| Events | `session_complete {mode, category, total, rounds, skips, hints}`, `streak_end {category, length, best}`, `summary_share_tap`, `summary_play_again` |

Interstitial ad (free users) shows before this screen, not after (see 07).

### 2.7 Daily intro (`(tabs)/daily`)

| | |
|--|--|
| Purpose | Explain today's set and start it, or show today's result if played. |
| Elements | "Uzmini Cenu #37", date in Europe/Riga, category icons of the 5 rounds (not the listings), rules line ("5 kārtas, bez laika, viens mēģinājums"), friends who already played (avatars), daily streak flame, countdown |
| Primary | "Spēlēt" → round (mode daily); if played → "Skatīt rezultātu" → daily result |
| Secondary | leaderboard link, "Kā skaita punktus?" info sheet |
| In | tab, home card, `/d/{n}` deep link, push "Dienas izaicinājums gatavs" (09:00 Riga) |
| Out | round, daily result, leaderboard |
| Loading | skeleton while `get_daily()`; resumes a half-finished daily automatically ("Turpināt: 3. kārta") |
| Empty | set missing: "Šodienas izaicinājums vēl gatavojas" + retry every 30 s |
| Error | offline: "Nav savienojuma" with retry; if a local unsent result exists, show it with "gaida sinhronizāciju" |
| Events | `daily_view {daily_no, state}`, `daily_start {daily_no, resume}`, `daily_info_tap` |

### 2.8 Daily result / share (`daily/result`)

```
┌──────────────────────────────────┐
│ ✕                                │
│        Uzmini Cenu #37           │
│                                  │
│        3 410 / 5 000             │
│        🟩🟩🟨🟥🟩                │
│        🔥 5 dienas pēc kārtas    │
│                                  │
│  1  Purvciems, 3 ist.  78 500   923  🟩 │
│  2  Golf 2008          4 200    852  🟩 │
│  3  Mārupe, māja     245 000    301  🟨 │
│  4  Dīvāns                35     41  🟥 │
│  5  Centrs, 2 ist.   129 000  1 000  🟩 │
│                                  │
│  Šodien: 14. vieta no 812        │
│  Draugi: 2. no 6  (Anna 4 120)   │
│                                  │
│ [ ⎘ Kopēt ]                      │
│ [           Dalīties            ]│
│  Nākamais pēc 14:22:05           │
└──────────────────────────────────┘
```

| | |
|--|--|
| Purpose | Produce the share moment. Everything else on the screen supports that button. |
| Elements | Title, total, grid, daily streak, 5 round rows (tap → reopen that reveal read-only), global rank and friends rank (signed-in), share, copy, countdown |
| Primary | "Dalīties" → iOS share sheet with the 3-line text (02 §3.3) |
| Secondary | copy, tap a row, "Līderu tabula", close |
| In | round 5 reveal, daily intro (played state), home card |
| Out | leaderboard, reveal (read-only), home |
| Loading | ranks load async; total and grid render immediately from local |
| Empty | anonymous: ranks replaced with "Pieraksties, lai redzētu savu vietu" → sign-in sheet; on success, result uploads and ranks appear without leaving the screen |
| Error | rank fetch fails: rows hidden, share still works |
| Events | `daily_complete {daily_no, total, grid, streak_days}`, `daily_share_tap {method: 'sheet' \| 'copy'}`, `daily_share_complete {activity}` (from share sheet callback), `daily_result_row_tap {round_no}` |

### 2.9 Leaderboard (`leaderboard`)

| | |
|--|--|
| Purpose | Compare. Daily/weekly/all-time, global/friends. |
| Elements | Segmented Diena / Nedēļa / Visu laiku; toggle Globāli / Draugi; list rows (rank, avatar, username, total, grid for daily, premium badge); own row pinned at bottom if outside the list; week picker for previous weeks (≤ 4 back) |
| Primary | none (browse) |
| Secondary | tap a row → public profile sheet (username, bests, add friend / duel), report user, refresh (pull) |
| In | home, daily intro/result, profile |
| Out | friends (add), duel invite (from profile sheet) |
| Loading | 10 skeleton rows |
| Empty | friends scope with no friends: "Pievieno draugus" CTA; day with no results yet: "Vēl neviens nav spēlējis. Esi pirmais." |
| Error | "Nevar ielādēt tabulu" + retry; last cached board shown greyed |
| Events | `leaderboard_view {scope, period}`, `leaderboard_row_tap {rank}`, `leaderboard_report {target}` |

### 2.10 Friends (`(tabs)/friends`)

| | |
|--|--|
| Purpose | Manage friends, see duel records, start duels. |
| Elements | Search by username, "Kopīgot manu profilu" link (`/u/{username}`), pending requests (incoming with accept/decline, outgoing), friends list rows (avatar, username, W-L-D vs you, today's daily grid, "Duelis" button), duel history section (last 20: opponent, result, date, rematch) |
| Primary | "Duelis" per row → `duel/invite` prefilled |
| Secondary | accept/decline, remove friend (swipe), share profile link |
| In | tab, leaderboard profile sheet, `/u/{username}` link |
| Out | duel invite, duel result (from history) |
| Loading | skeleton rows |
| Empty | no friends: illustration + "Meklē pēc lietotājvārda vai nosūti savu saiti"; anonymous: sign-in card explaining friends need an account |
| Error | search fail inline; list uses cache |
| Events | `friends_view`, `friend_search {query_len, results}`, `friend_request_sent`, `friend_request_accepted`, `friend_removed`, `profile_link_shared` |

### 2.11 Duel invite (`duel/invite`, modal)

| | |
|--|--|
| Purpose | Pick an opponent, send the push. |
| Elements | Friend list with online dot (presence) and "last played" time, category selector (Visi default, or one), remaining free invites badge ("2 / 3 šodien"), send |
| Primary | "Izaicināt" → `invite_duel` → `duel/[duelId]` in `invited` state |
| Secondary | "Uzaicināt draugu ārpus app" (shares `/u/` link), close |
| In | home Duel tile, friends row, leaderboard profile sheet, duel result rematch |
| Out | duel screen, paywall (free limit hit) |
| Loading | friend list skeleton |
| Empty | no friends → friends tab CTA |
| Error | push fails server-side: duel still created, banner "Push neizdevās, draugs redzēs ielūgumu app" |
| Events | `duel_invite_open {source}`, `duel_invite_sent {duel_id, category}`, `duel_invite_limit_hit` |

### 2.12 Duel round (`duel/[duelId]`)

One route rendering by `duels.status` and round state:

```
invited (challenger view)          live / async round               waiting others
┌──────────────────────┐   ┌──────────────────────────────┐   ┌────────────────────────┐
│ ✕  Duelis ar Annu    │   │ ✕ 2/5   ◔ 0:18   Tu 923 · A 670│   │ Prasa                  │
│                      │   │ ┌──────────────────────────┐ │   │ ▒▒▒▒▒▒ €               │
│   [avatar] vs [avatar]│   │ │      [ photo 1/3 ]       │ │   │                        │
│   Gaidām Annu…       │   │ └──────────────────────────┘ │   │ Tavs: 72 000 €         │
│   Ielūgums nosūtīts  │   │ AUTO · Rīga                  │   │ Anna: domā… ◔ 0:12     │
│   14:02              │   │ VW Golf · 2008 · 1.9 D ·     │   │                        │
│                      │   │ Manuāla · 245 000 km         │   │ (count-up starts when  │
│ Sāc spēlēt tagad →   │   ├──────────────────────────────┤   │  both guesses are in)  │
│ (async, Anna spēlēs  │   │          4 500 €             │   │                        │
│  vēlāk)              │   │ [−500][−100]    [+100][+500] │   └────────────────────────┘
│                      │   │   1   2   3                  │
│ [ Atcelt ielūgumu ]  │   │   4   5   6                  │
└──────────────────────┘   │   7   8   9                  │
                           │  000  0   ⌫                  │
                           │ [        Uzmini!            ]│
                           └──────────────────────────────┘
```

| | |
|--|--|
| Purpose | Play 5 synced rounds against one friend. |
| Elements | Round component with timer ring, header score strip "Tu 923 · Anna 670", opponent state pill (domā… / iesniedza ✓ / bezsaistē), reveal modal with two markers on the bar, between-round 3 s scoreboard; `invited` view for challenger (waiting, start async, cancel); opponent view from push: accept sheet "Anna izaicina tevi · Visi · 5 kārtas" with "Spēlēt" / "Vēlāk" |
| Primary | "Uzmini!" in round; "Spēlēt" in accept sheet |
| Secondary | close (duel continues async; confirm sheet), cancel invite (challenger, before accept), emoji reaction (broadcast, v1.1) |
| In | duel invite, push `/duel/{id}`, friends history, home badge |
| Out | duel result, home (on close) |
| Loading | fetching duel row + snapshot: skeleton; realtime subscribe before render |
| Empty | n/a |
| Error | expired duel: "Duelis beidzies" with rematch; not participant: "Šis duelis nav tavs"; connection lost mid-round: banner, timer keeps running server-side, auto-resume on reconnect |
| Events | `duel_view {duel_id, status, role}`, `duel_accept {duel_id, seconds_since_invite}`, `duel_decline`, `duel_cancel`, `duel_round_submit {duel_id, round_no, score, seconds_spent, sync}`, `duel_timeout {round_no}`, `duel_went_async {reason}` |

### 2.13 Duel result (`duel/[duelId]/result`)

| | |
|--|--|
| Purpose | Declare the winner, drive the rematch. |
| Elements | Big "Tu uzvarēji!" / "Zaudējums" / "Neizšķirts", totals, 5 row comparison (listing thumb, your guess, their guess, price, both scores), updated W-L-D vs this friend, share text (`Duelis: Mārtiņš 3 410 – Anna 2 980 · uzminicenu.lv`) |
| Primary | "Revanšs" → creates new duel with roles swapped → `duel/[newId]` |
| Secondary | share, "Uz sākumu", tap row → read-only reveal |
| In | round 5 reveal (sync), push "Duelis pabeigts" (async), friends history |
| Out | new duel, home |
| Loading | if opponent not finished (async): shows own rows, "Anna vēl nav spēlējusi" with her progress (x/5), no winner yet |
| Error | fetch fails: cached rows |
| Events | `duel_complete {duel_id, result: win\|lose\|draw, my_total, their_total, sync}`, `duel_rematch_tap`, `duel_share_tap` |

### 2.14 Room lobby (`room/[code]`, status `lobby`) — v1.1

| | |
|--|--|
| Purpose | Gather up to 10 players, host configures, start. |
| Elements | Big code "KTRP" with copy and share (`uzminicenu.lv/r/KTRP`), player avatars grid filling live (presence), host controls: category, rounds 5/10; non-host: "Gaidām saimnieku"; anonymous joiner: username prompt sheet first |
| Primary | host: "Sākt" (enabled at ≥ 2 players); others: none |
| Secondary | share code, leave, host: kick (long-press avatar) |
| In | home Istaba tile → create modal; `/r/{code}` link; code entry field on home |
| Out | room round (status `live`), home (leave) |
| Loading | joining: spinner on "Pievienojas…" |
| Empty | host alone: "Nosūti kodu draugiem" hint pulsing on share |
| Error | wrong code: "Istaba nav atrasta"; full: "Istaba ir pilna (10)"; started: "Spēle jau sākusies" with spectate (v1.2) or home |
| Events | `room_create {category, rounds}`, `room_join {code, via: link\|code}`, `room_share_code`, `room_start {players}`, `room_leave {stage}` |

### 2.15 Room round (`room/[code]`, status `live`)

| | |
|--|--|
| Purpose | Same round, 2-10 players, 30 s. |
| Elements | Round component with timer ring, "6/8 iesnieguši" counter, avatars turning green as they submit; reveal modal with everyone's guesses as markers on the bar (top 3 labelled, rest as dots), 5 s scoreboard between rounds (rank, name, round score, total, movement arrows) |
| Primary | "Uzmini!" |
| Secondary | leave (confirm), emoji reactions (broadcast) |
| In | lobby start, reconnect via `/r/{code}` |
| Out | podium after last round |
| Loading | between rounds while `current_round` increments: scoreboard covers it |
| Error | disconnect: banner, rejoin fetches `current_round`; missed rounds score 0 |
| Events | `room_round_submit {code, round_no, score, seconds_spent}`, `room_round_timeout`, `room_reconnect {missed_rounds}` |

### 2.16 Room podium (`room/[code]`, status `finished`)

| | |
|--|--|
| Purpose | Celebrate, keep the group playing. |
| Elements | Podium 1-2-3 with avatars and totals (confetti for 1st on own device), full ranking list, per-round best guess highlights ("Precīzākais: Anna, 2. kārta, 1,1 %"), share text (`Istaba KTRP · 1. Anna 8 120 · 2. Tu 7 940 · 3. Jānis 6 300`) |
| Primary | host: "Spēlēt vēlreiz" (same room, players kept, new listings); others: "Gaidām saimnieku" |
| Secondary | share, leave |
| In | last round reveal |
| Out | lobby (play again), home |
| Events | `room_complete {code, players, my_rank, my_total}`, `room_play_again`, `room_share_result` |

### 2.17 Profile / settings (`(tabs)/profile`, `settings/*`)

| | |
|--|--|
| Purpose | Identity, stats, preferences, legal. |
| Elements | Avatar (preset icons, no uploads in v1), username (edit, uniqueness check), premium badge / "Uzmini Cenu Plus" upsell row, stats: dailies played, daily streak, best total, bests per category (streak), duel W-L-D, bias line ("Tu pārvērtē Purvciemu par 12 %", premium); settings list: language, haptics, sound, notifications (daily reminder time, duel invites, results), replay onboarding, restore purchases, privacy policy, terms, takedown/contact email, delete account, sign out, version |
| Primary | none |
| Secondary | edit username, paywall, each setting row |
| In | tab, home avatar |
| Out | paywall, sign-in, settings subroutes, system notification settings |
| Loading | stats skeleton |
| Empty | anonymous: card "Pieraksties ar Apple, lai saglabātu rezultātus un spēlētu ar draugiem" replaces username/stats; local bests still shown |
| Error | username taken: inline; delete account: confirm twice, then `delete_account` RPC, local wipe, back to onboarding |
| Events | `profile_view`, `username_changed`, `setting_changed {key, value}`, `notifications_toggled {type, on}`, `account_delete_start`, `account_deleted`, `sign_out` |

### 2.18 Paywall (`paywall`, modal)

| | |
|--|--|
| Purpose | Convert to Plus. Shown contextually, never on launch. |
| Elements | Title "Uzmini Cenu Plus", 5 benefits (no ads, unlimited duels, streak stats, category stats, custom rooms, badge), plan toggle month €2.99 / year €14.99 ("ietaupi 58 %"), "7 dienas bez maksas" line, trial terms, restore purchases, close |
| Primary | "Sākt bezmaksas nedēļu" → RevenueCat purchase |
| Secondary | plan toggle, restore, terms/privacy links, close |
| In | free duel limit hit, after 3rd interstitial in a session ("Apnikušas reklāmas?"), profile upsell row, stats locked rows |
| Out | back to the triggering screen with the feature unlocked |
| Loading | offerings fetch: skeleton prices; if fails, close with toast |
| Error | purchase fails/cancelled: stay, inline message; already subscribed: auto-close |
| Events | `paywall_view {source}`, `paywall_plan_toggle {plan}`, `paywall_purchase_start {plan}`, `paywall_purchase_success {plan, trial}`, `paywall_purchase_fail {code}`, `paywall_restore`, `paywall_close {seconds}` |

### 2.19 Sign-in (`sign-in`, modal sheet)

| | |
|--|--|
| Purpose | Upgrade an anonymous session to an Apple-linked account without losing local data. |
| Elements | Context line explaining why ("Lai parādīties tabulā un spēlēt duelus"), Sign in with Apple button (native), "Vēlāk", privacy note; after success: username picker (suggested from Apple name, sanitised, uniqueness check) |
| Primary | Sign in with Apple → `linkIdentity` on the anonymous Supabase session (keeps `user_id`, so local guesses and bests attach) |
| Secondary | "Vēlāk" |
| In | any screen that needs an account (daily result ranks, friends, duel push, leaderboard banner, profile) |
| Out | back to the caller, which refreshes |
| Loading | spinner over button during Apple flow and profile creation |
| Error | Apple cancelled: silent close; link fails because the Apple id already has an account: offer "Pārslēgties uz esošo kontu" (local anonymous data is then lost, say so) |
| Events | `signin_view {source}`, `signin_success {method: apple, linked_anonymous}`, `signin_cancel`, `signin_error {code}`, `username_set {source: signin}` |

## 3. Cross-cutting states

| State | Pattern |
|-------|---------|
| Offline | Top banner "Nav savienojuma" on every screen; solo continues from prefetch; competitive screens show a blocking sheet with retry |
| Loading | Skeletons shaped like the content, never spinners on full screens; spinners only inside buttons |
| Error | Inline, near the failed element, with one retry button; toasts only for non-blocking notices (copied, token expired) |
| Empty | One sentence + one CTA, illustration optional |
| Confirm | Bottom sheets, destructive action red, cancel always first in reading order |
| Push permission | Asked after the first daily is completed or when sending the first duel invite, with a pre-prompt explaining the value; never on first launch |
| Ads | Interstitial only after round 5 and 10 in free play; rewarded video only from the hint button; nothing in daily/duel/room |

## 4. Analytics event summary

Core funnel events every dashboard uses, in order:

```
app_open → onboarding_complete → home_daily_tap → daily_start → round_submit ×5
        → daily_complete → daily_share_tap → daily_share_complete
signin_success → friend_request_sent → duel_invite_sent → duel_accept → duel_complete → duel_rematch_tap
paywall_view → paywall_purchase_start → paywall_purchase_success
```

Common properties on every event: `lang`, `is_anon`, `is_premium`, `app_version`,
`daily_no` (current), `session_id`. User id is the Supabase uuid; anonymous
users keep the same uuid after linking so funnels survive sign-in.
