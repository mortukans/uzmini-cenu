# App Review reply — Guideline 2.1 Information Needed (2026-09-26)

Sent 2026-10-02 as the App Store Connect reply (with the screen recording
UzminiCenu-review-walkthrough.mp4 attached) and kept in the App Review Notes field.
The new build attached to the submission is 0.1.0 (27).

---

Thank you for the review. Answers to each point:

1. SCREEN RECORDING
Attached (UzminiCenu-review-walkthrough.mp4), captured on an iPhone running the latest iOS, build 0.1.0 (27). It starts with launching the app and shows: the intro slides; "Sign in with Apple" (restores an existing account); the Daily challenge (5 rounds, reveal, result grid, leaderboard, share); Free play in the Cars category (10 rounds with hints and skips, result list); Profile with username change; the Friends tab with "Create room" and the share-code sheet; Profile → Delete account (confirmation, everything deleted); then launching again as a new anonymous user, Sign in with Apple, the 3-round practice, and the home screen. Account creation is automatic and anonymous, so "registration" is simply the first launch; linking/sign-in with Apple or Google is optional. There is no paid content and no user-generated content other than a username.

2. PURPOSE AND AUDIENCE
Uzmini Cenu ("Guess the Price") is a casual quiz game for people in Latvia. The player sees a real classified listing from a Latvian portal (a flat, a house, a car or a household item), guesses its asking price and scores points for accuracy. The value is entertainment plus a feel for real market prices: everyone in Latvia browses these portals, and guessing "how much is a 3-room flat in Purvciems" is something people already do with friends. Target audience: adults and teens in Latvia (Latvian and Russian speaking) who enjoy daily puzzle games such as Wordle. Rated 4+ because the content is listings of homes, cars and furniture.

3. SETUP AND ACCESS
No credentials are needed. On first launch the app creates an anonymous account automatically; Apple/Google sign-in is optional (it only saves progress across devices). Main features:
- Play (home tab): "Free play" or "Streak", pick a category and region, guess prices.
- Daily (tab): the same 5 listings for everyone, once per day, with a shareable result and leaderboard.
- Friends (tab): choose a username when prompted, search another user by username, send a duel invite (needs two devices: invite → accept → both play 5 rounds). Rooms work the same with a 4-letter code.
- Profile (tab): change username, language (Latvian/Russian/English), sign out, and "Delete account", which removes all server data immediately.
The app defaults to Latvian; switch to English in Profile → Language.

4. EXTERNAL SERVICES
- Supabase (database, anonymous + Apple/Google authentication, realtime, edge functions), hosted in the EU (Paris).
- Sign in with Apple and Google Sign-In (optional account linking).
- Apple Push Notification service via Expo's push service, used only for duel/room invites and results.
- GitHub Pages for the privacy policy and support pages.
- Listing content comes from the public Latvian classifieds portal SS.com: we store only factual attributes (asking price, size, rooms, district or town, year, mileage) and a link to the original listing; photos are loaded directly from the portal's servers and are not stored by us. Every round credits the source and links back to it.
No advertising SDKs, no analytics SDKs, no payment processors and no AI services.

5. REGIONAL DIFFERENCES
None. The app functions identically in all regions. The content itself is Latvian (listings from Latvia, Latvian UI by default), which is the intended market.

6. REGULATED INDUSTRY / THIRD-PARTY MATERIAL
Not a regulated industry: no wagering, no real-money prizes, nothing is bought or sold, and prices shown are asking prices from public listings, not valuations. Third-party material: we display only facts and hotlinked photos from publicly accessible listings with attribution and a link back, never contact details or exact addresses, and we operate a 24-hour takedown process for any advertiser or portal (https://mortukans.github.io/uzmini-cenu/support.html).

Contact during review: mortukans@gmail.com, +371 28848053 (Riga, EET).
