# 01 Product vision

## One-liner

GeoGuessr for Latvian prices: you see a real SS.com / City24 listing, you guess
what they are asking, you get scored on how close you are. Play alone, play the
same daily set as everyone else, or challenge a friend live.

## Why it works

- Everyone in Latvia browses SS.com already. Guessing "how much is this flat in
  Purvciems" is something people do for fun with friends anyway.
- Real listings mean infinite content for free. No level design.
- Daily challenge + shareable result grid is the proven Wordle growth loop.
- Nothing exists locally. Only a furniture shop's Facebook promo called
  "Uzmini cenu".

## Target users

1. **Primary:** 18-40, Riga and big towns, scrolls SS.com for entertainment,
   plays Wordle-type dailies. Latvian and Russian speaking. English UI optional.
2. **Secondary:** people actively hunting a flat or car who want to calibrate
   their sense of the market.
3. **Tertiary:** real estate agents and car dealers as a fun tool, and a
   possible B2B / sponsorship channel.

## Competitor snapshot

| Game | Market | Core mechanic | Multiplayer | Money |
|------|--------|---------------|-------------|-------|
| Housle | US homes | 6 guesses, hints unlock, win within 5% of list price; daily + endless streak | Leaderboard, share to social | Ads + premium sub |
| CribGuessr | US homes | 5 rounds, up to 1000 pts per round by closeness | Room code, up to 10 players, real-time | Free |
| Costcodle | Costco items | Daily single item, higher/lower arrows, 6 tries | Share grid | Free |
| Curb Value | US homes | Street View image, 5 tries within 5% | Daily leaderboard | Free |

Housle has only a few thousand installs per store. The genre is a niche
casual game, not a unicorn. Plan costs accordingly: solo dev, near-zero
infrastructure cost, monetize lightly.

## Differentiation

- **Local.** Riga micro-districts, Jurmala houses, 2008 Golf on SS. People know
  these prices in their gut. That is the fun.
- **Multi-category.** Flats, houses, cars, and a "random SS junk" category.
  The junk category is the one people will screenshot.
- **Live duel with a friend** via push notification. CribGuessr has rooms but
  no invite flow, Housle has none.
- **Links back to the real listing.** Every round ends with "open on SS.com".
  This is also the argument for a partnership with the portals.

## Non-goals for v1

- Valuation tool or price estimates. We show asking prices, not truth.
- User-generated listings.
- Web version (maybe later for the daily challenge share landing page).
- Android launch (build pipeline should support it, but iOS ships first).

## Success criteria for v1 (3 months after launch)

- 1,000 installs in Latvia without paid ads.
- 20% of daily-challenge players return next day.
- At least 1 portal has replied to a partnership email.
