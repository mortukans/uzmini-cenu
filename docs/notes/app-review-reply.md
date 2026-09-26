# App Review reply — Guideline 2.1 Information Needed (2026-09-26)

Paste into the App Store Connect message thread AND the App Review Notes field.

---

Thank you for the review. Answers to each point:

1. SCREEN RECORDING
Attached: a recording captured on an iPhone 14 Pro Max running the latest iOS. It starts with launching the app and shows: the 3-round intro, a solo round (photo, price entry, reveal with score and "open listing"), the daily challenge and its result grid, picking a username, the friends/duel screen, and finally Profile → Delete account (the app supports account creation, so deletion is included). There is no login, no paid content, and no user-generated content beyond a username.

2. PURPOSE AND AUDIENCE
Uzmini Cenu ("Guess the Price") is a casual quiz game for people in Latvia. The player sees a real classified listing from Latvian portals (a flat, a house, a car or a household item), guesses its asking price, and scores points for accuracy. The value is entertainment plus a feel for real market prices: everyone in Latvia browses these portals, and guessing "how much is a 3-room flat in Purvciems" is something people already do with friends. Target audience: adults and teens in Latvia (Latvian and Russian speaking) who enjoy daily puzzle games such as Wordle; the app is rated 4+ because the content is listings of homes, cars and furniture.

3. SETUP AND ACCESS
No login and no credentials are needed. On first launch the app creates an anonymous account automatically. Main features:
- Play (home tab) → "Free play" or "Streak": pick a category and region, guess prices.
- Daily (tab): the same 5 listings for everyone, once per day, with a shareable result.
- Friends (tab): pick a username when prompted, search another user by username, send a duel invite; a duel needs two devices (invite → the other device accepts → both play 5 rounds). Rooms work the same with a 4-letter code.
- Profile (tab): change username, language (Latvian/Russian/English), and "Delete account", which removes all server data immediately.
The app defaults to Latvian; switch to English in Profile → Language.

4. EXTERNAL SERVICES
- Supabase (database, anonymous authentication, realtime and edge functions), hosted in the EU (Paris).
- Apple Push Notification service via Expo's push service, used only for duel invites and results.
- GitHub Pages for the privacy policy and support pages.
- Listing content comes from public Latvian classifieds portals (SS.com): we store only factual attributes (asking price, size, rooms, district or town, year, mileage) and a link to the original listing; photos are loaded directly from the portal's servers and are not stored by us. Every round credits the source and links back to it.
No advertising SDKs, no analytics SDKs, no payment processors and no AI services are used.

5. REGIONAL DIFFERENCES
None. The app functions identically in all regions. The content itself is Latvian (listings from Latvia and Latvian-language UI by default), which is the intended market.

6. REGULATED INDUSTRY / THIRD-PARTY MATERIAL
The app is not in a regulated industry: there is no wagering, no real-money prizes, nothing is bought or sold, and prices shown are asking prices from public listings, not valuations. Regarding third-party material: we display only facts and hotlinked photos from publicly accessible listings with attribution and a link back, never contact details or exact addresses, and we operate a 24-hour takedown process for any advertiser or portal (published at https://mortukans.github.io/uzmini-cenu/support.html). We are also in contact with the portal about a formal partnership.

Contact for any question during review: mortukans@gmail.com, +371 28848053 (Riga, EET).
