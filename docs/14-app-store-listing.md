# 14 App Store listing

Primary locale: Latvian. Additional: English (UK), Russian. Fill in App
Store Connect during P4.5, final pass in P5.1. Placeholders in `<angle
brackets>` are resolved once the name and domain are fixed (P0.5).

## App name options

App Store title is max 30 characters. Subtitle max 30. Both are indexed
for search, so put the strongest keywords there and keep them out of the
keyword field.

| Option | Title (lv) | Subtitle (lv) | Notes |
|--------|------------|---------------|-------|
| A (default) | `Uzmini Cenu` | `Cik maksā šis dzīvoklis?` | working title, memorable, matches the share text; lawyer checks the furniture-shop campaign (09 Q8) |
| B | `Cik Maksā?` | `Uzmini dzīvokļu un auto cenas` | question as brand, very Latvian; harder to say as one word in Russian/English |
| C | `Cenu Guru` | `Uzmini Latvijas cenas` | works in all three languages; slightly generic |
| D | `Uzmini Cenu: Rīga` | `Dzīvokļi, auto un dīvaini sludinājumi` | geo-anchored, strong ASO for "rīga", limits national feel |

Decision goes to README via P0.5. Everything below assumes option A.

Localised title / subtitle:

| Locale | Title | Subtitle |
|--------|-------|----------|
| lv | Uzmini Cenu | Cik maksā šis dzīvoklis? |
| en (UK) | Uzmini Cenu – Guess the Price | Latvian flats, cars and more |
| ru | Uzmini Cenu – Угадай цену | Квартиры, авто и не только |

## Description

### Latvian (primary, ≤ 4000 chars)

```
Cik maksā trīsistabu dzīvoklis Purvciemā? Un 2008. gada Golfs ar 240 tūkstošiem
nobraukumā? Un šis dīvāns?

Uzmini Cenu ir spēle, kurā tu redzi reālu sludinājumu no Latvijas portāliem,
mini tā cenu un saņem punktus par precizitāti. Jo tuvāk, jo vairāk punktu.
Katra raunda beigās vari atvērt oriģinālo sludinājumu.

DIENAS IZAICINĀJUMS
Katru dienu visiem vieni un tie paši 5 sludinājumi. Izspēlē, saņem savu
rezultātu režģi un padalies ar draugiem. Skaties, kurš Latvijas cenas zina
labāk.

BRĪVĀ SPĒLE
Bezgalīgi raundi. Izvēlies kategoriju – dzīvokļi, mājas, auto vai "dažādi"
(jā, tur ir arī tas dīvāns) – un reģionu: Rīga, Pierīga vai visa Latvija.

SĒRIJA
Vienu reizi kļūdies, un sērija beidzas. Cik tālu tu aiziesi?

DUELIS
Izaicini draugu. Viņš saņem paziņojumu, jūs abi spēlējat vienus un tos pašus
5 raundus, un uzvar tas, kurš tuvāk. Var spēlēt reāllaikā vai katrs savā
laikā.

LĪDERU TABULA
Dienas un nedēļas tabulas – globālās un starp draugiem.

UZMINI CENU PLUS
Bez reklāmām, neierobežoti dueļi, tava statistika pa kategorijām un rajoniem.
7 dienas bez maksas, pēc tam €14,99 gadā vai €2,99 mēnesī. Atcelt var jebkurā
brīdī.

Spēlē rāda sludinājumu faktus un fotogrāfijas no publiskiem Latvijas
portāliem ar norādi uz avotu. Kontaktinformācija un precīzas adreses netiek
rādītas. Cenas ir sludinājumos norādītās prasītās cenas, ne vērtējums.

Jautājumi, ieteikumi vai lūgums noņemt sludinājumu: <support email>.
```

### English (UK)

```
How much is a three-room flat in Purvciems? A 2008 Golf with 240,000 km? This
sofa?

Uzmini Cenu ("Guess the Price") shows you a real listing from Latvian
classifieds portals. You guess the asking price and score points for
accuracy. The closer you are, the more you get. Every round ends with a link
to the original listing.

DAILY CHALLENGE
The same 5 listings for everyone, every day. Play, get your result grid and
share it with friends. Find out who really knows Latvian prices.

FREE PLAY
Endless rounds. Pick a category – flats, houses, cars or "random" (yes, the
sofa lives there) – and a region: Riga, Riga region or all of Latvia.

STREAK
One miss and it's over. How far can you go?

DUEL
Challenge a friend. They get a notification, you both play the same 5
rounds, closest guess wins. Live or whenever each of you has time.

LEADERBOARDS
Daily and weekly, global and friends-only.

UZMINI CENU PLUS
No ads, unlimited duels, your personal stats by category and district. 7
days free, then €14.99 a year or €2.99 a month. Cancel anytime.

The game shows listing facts and photos from public Latvian portals, always
credited and linked to the source. Contact details and exact addresses are
never shown. Prices are asking prices from the listings, not valuations.

Questions, ideas or a listing removal request: <support email>.
```

Russian description: translate from Latvian in P4.5, proofread by a native
speaker among the beta testers.

## Promotional text (170 chars, editable without a new build)

- lv: `Jauns dienas izaicinājums katru dienu 00:05. Šodien: 2 dzīvokļi, māja, auto un kaut kas negaidīts.`
- en: `A new daily challenge every day at 00:05. Today: two flats, a house, a car and something unexpected.`

## Keyword field (100 chars, no spaces after commas)

See 07 ASO section for the reasoning. Exclude words already in the title
and subtitle for each locale.

| Locale | Keywords |
|--------|----------|
| lv | `dzīvokļi,auto,mašīna,māja,sludinājumi,spēle,viktorīna,ikdienas,izaicinājums,rīga,ss,cik,cenas` |
| en | `price,guess,quiz,daily,puzzle,apartment,car,house,riga,real estate,wordle,geoguessr,latvian` |
| ru | `цена,угадай,квартира,машина,авто,дом,объявления,игра,викторина,рига,латвия,ежедневно,ss` |

## Screenshot storyboard

6 screenshots per locale, portrait, 6.7" (1290×2796) and 6.1" (1179×2556)
via a template (Figma or Screenshots.pro-style tool). Real listings only
with attribution visible; blur nothing, since the attribution is part of
the argument to Apple. Caption at top in a bold sans, device frame below,
brand colour background.

| # | What the screen shows | Caption (lv) | Caption (en) |
|---|-----------------------|--------------|--------------|
| 1 | Round screen: a Riga flat photo, attributes chips (Purvciems · 3 ist. · 62 m² · 5/9), numeric pad with a guess half-typed | `Cik maksā šis dzīvoklis Purvciemā?` | `How much is this flat in Purvciems?` |
| 2 | Reveal screen mid-animation: real price counting up, error %, score 670, "Atvērt sludinājumā SS.com" button and source logo | `Uzmini tuvu – saņem punktus` | `Close guess, big points` |
| 3 | Daily result screen: `Uzmini Cenu #37  3,410 / 5,000` with the 🟩🟩🟨🟥🟩 grid and Share button | `Viens izaicinājums dienā. Visiem vienāds.` | `One challenge a day. Same for everyone.` |
| 4 | Duel screen: two avatars, round 3 of 5, both guesses revealed side by side with the real price between | `Izaicini draugu duelī` | `Challenge a friend to a duel` |
| 5 | Category picker: flats, houses, cars, random, with a funny `random` item thumbnail (a garden gnome or a Soviet-era TV) and region toggle | `Dzīvokļi, mājas, auto un… tas dīvāns` | `Flats, houses, cars and… that sofa` |
| 6 | Leaderboard (friends scope) with Plus badges, plus a small Plus banner: "Bez reklāmām · Neierobežoti dueļi" | `Kurš Latvijas cenas zina labāk?` | `Who knows Latvian prices best?` |

Optional 7th for the App Preview video: 20 s screen recording of one full
round with the reveal animation, no sound needed.

## Age rating answers

Full reasoning is in 09 section 4. Summary for the App Store Connect form:

| Question | Answer |
|----------|--------|
| Cartoon / fantasy violence | None |
| Realistic violence | None |
| Prolonged graphic violence | None |
| Profanity or crude humour | None |
| Mature / suggestive themes | None |
| Horror / fear themes | None |
| Medical / treatment information | None |
| Alcohol, tobacco, or drug use or references | None |
| Simulated gambling | None |
| Sexual content or nudity | None |
| Graphic sexual content | None |
| Contests | None |
| Unrestricted web access | No |
| Gambling | No |
| Made for Kids | No |
| Resulting rating | 4+ |

## App Review notes

Paste into "Notes" in App Store Connect. Include a demo account and a
friend account so the reviewer can test duels.

```
Thank you for reviewing Uzmini Cenu.

WHAT THE APP DOES
A quiz game: the player sees a real classified listing from Latvian portals
(flat, house, car or a household item) and guesses its asking price. Points
are awarded for accuracy. There is no wagering, no real-money prizes, and no
way to buy or sell anything in the app.

CONTENT SOURCING (guideline 5.2.2)
- Listing data consists of factual attributes (asking price, size, rooms,
  district or town, year, mileage) and a link to the original listing. Facts
  are not copyrightable; we store only these facts and the source URL.
- Photos are loaded directly from the source portal's servers and are not
  stored or modified by us. Every round shows the source name and a button
  that opens the original listing on the portal, so the app drives traffic
  back to the source.
- We remove all personal data (names, phone numbers, emails, exact
  addresses) before anything is shown. Location is shown at district / town
  level only.
- Source portals have been contacted in writing with a partnership proposal
  <and have consented in writing: see attached letter / or: correspondence
  is ongoing>. We operate a takedown process: any owner or portal can request
  removal at <takedown email>, and content is removed within 24 hours.
- Listings we show are the same ones publicly visible to anyone visiting the
  portal without an account.

ACCOUNTS
Sign in with Apple is the only third-party login. Anonymous play works
without an account. Account deletion is in Profile → Settings → Delete
account and removes all server data.

DEMO ACCOUNTS
Reviewer account: <email> / Sign in with Apple is not needed; tap "Continue
without account", or use the test login "Reviewer mode" via Settings →
About → tap version 7 times → enter code <code> to sign in as
`reviewer1`. A second account `reviewer2` is already a friend of
`reviewer1` so duel invites can be tested from one device: send an invite,
then switch account in Settings → Reviewer mode to accept it.

SUBSCRIPTION
"Uzmini Cenu Plus" (monthly and annual, 7-day free trial) removes ads and
lifts the daily duel limit. Terms and price are shown on the paywall.
Restore purchases is on the paywall.

ADS
Google AdMob interstitials appear in free play every 5 rounds and rewarded
video is optional for hints. App Tracking Transparency is requested before
any personalised ad. No ads inside the daily challenge or duels.

LANGUAGE
The app defaults to Latvian; switch to English in Profile → Settings →
Language.

Contact for questions during review: <email>, <phone>. Riga time (EET).
```

## URLs and metadata

| Field | Value |
|-------|-------|
| Privacy Policy URL | `https://<domain>.lv/privacy` (placeholder until P5.2; must be live before submission) |
| Terms of Use (EULA) | `https://<domain>.lv/terms` (custom EULA link in the description and paywall; App Store Connect field "License Agreement" left as Apple standard unless the lawyer says otherwise) |
| Support URL | `https://<domain>.lv/support` with the support and takedown emails, FAQ (why is this listing here, how do I remove my listing, how do I delete my account, how do I cancel Plus) |
| Marketing URL | `https://<domain>.lv` (landing page with today's challenge) |
| Support email | `support@<domain>.lv` |
| Takedown email | `takedown@<domain>.lv` |
| Copyright | `© <year> Mārtiņš Mortukāns` (or SIA name) |
| Primary category | Games → Trivia |
| Secondary category | Games → Puzzle (alternative: Lifestyle, if Apple positions real-estate-like content there; Trivia first) |
| Content rights | "Contains third-party content" → Yes, with the review notes above |
| Bundle id | `lv.<domain>.uzminicenu` |
| SKU | `uzminicenu-ios` |
| Price | Free with in-app purchases |
| Availability | Latvia first; add Estonia, Lithuania and worldwide after week 4 (Latvian diaspora installs are free) |
| In-app purchases to display | `Uzmini Cenu Plus (gads)`, `Uzmini Cenu Plus (mēnesis)` with display names localised |
| Version release | Manual release after approval (so launch day is a Tuesday, see 07) |
| Phased release | Off for v1.0 (small country; want all installs on day 1), On from v1.1 |
| App Store Connect contact | name, phone, email of the developer |
