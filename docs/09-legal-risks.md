# 09 Legal and risk register

Not legal advice. Everything below is a developer's reading of public
sources, written to make the one-hour lawyer consult (P0.6) efficient. Where
the lawyer disagrees, the lawyer wins; record the answers in
`docs/notes/lawyer.md`.

## 1. Listing content rights (highest risk)

- Photos are copyrighted by the advertiser (or the portal via its terms).
  Text and photos together, plus the collection, are protected in the EU by
  copyright and the sui generis database right.
- SS.com's public rules address advertisers, not automated access, and no
  explicit anti-scraping clause was found. Absence of a clause is not
  permission.
- Mitigations, in order:
  1. **Partnership.** Pitch: every round links to the listing, the game is
     free promotion, we will show their logo. Offer them the sponsored daily
     set. Ask for a written OK to display listing data and photos.
  2. **Link, don't copy.** Store only facts (price, m2, district) and URLs.
     Facts are not copyrightable. Load photos from their CDN, do not store
     them. Attribute the source on every round.
  3. **Fallback content.** If a portal objects: remove their listings within
     24 h (build the kill switch: `update listings set status='rejected'
     where source='ss'`), and continue with portals that agree, plus the
     numbers-only sale-price mode from public land registry data.
- Keep a takedown email address and honour requests from individual
  advertisers too.

### 1a. EU Database Directive (96/9/EC) as it applies to us

General reading, flagged for the lawyer:

- The directive gives two layers: copyright in the *structure* of a database
  (original selection or arrangement) and the **sui generis right** for a
  database whose maker made a *substantial investment* in obtaining,
  verifying or presenting its contents. SS.com and City24 almost certainly
  qualify as makers under the sui generis right; they invest heavily in
  collecting and verifying listings.
- The sui generis right prohibits **extraction and/or re-utilisation of the
  whole or a substantial part** of the contents, evaluated quantitatively
  *or* qualitatively. It also prohibits **repeated and systematic**
  extraction of insubstantial parts if that conflicts with normal
  exploitation or unreasonably prejudices the maker's legitimate interests.
- Where we sit: a nightly scraper taking 200-400 listings per category is
  "repeated and systematic". Whether it "conflicts with normal exploitation"
  is the argument. Our position: we drive traffic back, we display a tiny
  slice at any time, we do not compete as a classifieds portal, and we do
  not offer search over their data. That is a defence to argue, not a safe
  harbour.
- Lawful-user exceptions (Art. 8-9) are narrow and mostly about
  non-electronic or private use; they do not obviously cover an app.
- Text and data mining exceptions from the DSM Directive (2019/790,
  Art. 3-4) cover reproduction *for analysis*, and Art. 4 can be opted out
  of by the rightholder (robots.txt-style reservation). They do not cover
  *displaying* the extracted content to users. Do not rely on TDM.
- CJEU case law worth citing to the lawyer: *British Horseracing Board v
  William Hill* (substantial investment must be in creating the database,
  not the underlying data), *Innoweb v Wegener* (a meta search engine
  re-utilising a classifieds database infringed even without copying), *CV-
  Online Latvia v Melons* (2021, a **Latvian** case: aggregator linking to
  job ads; the CJEU said the maker must show the aggregator adversely
  affects investment, and balanced it against the aggregator's legitimate
  interest in access). CV-Online is the closest to our fact pattern and is
  Latvian; ask the lawyer how the Latvian courts applied it afterwards.
- Practical consequence: the partnership letter is the real protection.
  Everything else limits damage.

### 1b. Latvian Copyright Law (Autortiesību likums) as it applies

- Photographs are protected works regardless of artistic merit; the
  advertiser (or whoever pressed the shutter) is the author. Portal terms
  typically grant the portal a licence, sometimes with the right to
  sub-license. We need permission from someone in that chain to *display*
  a photo, even via hotlink, under a strict reading. Hotlinking has been
  treated more leniently in some CJEU communication-to-the-public cases
  (*Svensson*, *BestWater*) when the work is already freely available
  online and no restriction is circumvented; *VG Bild-Kunst v SPK* (2021)
  says framing that circumvents technical measures infringes. Not stripping
  or bypassing any hotlink protection is therefore a legal line, not just a
  technical courtesy.
- Section 19-ff exceptions (quotation, news reporting, private use,
  education) do not fit a commercial game. Quotation requires the purpose
  to justify the extent; using a photo as the puzzle itself is the main
  use, not an incidental quote.
- Facts (price, m2, year, district) are not works. A short factual title
  ("3 istabas, Purvciems") is unlikely to reach the originality threshold;
  a long, creative description might, which is one more reason we hide
  descriptions.
- Database protection in Latvia is Chapter IX of the Copyright Law
  (database makers' rights), implementing 96/9/EC; term is 15 years from
  completion and renews on substantial change, so live portals are always
  protected.
- Moral rights: the author can object to distortion. Blurring or cropping
  photos for the puzzle could be raised; keep photos unaltered except for
  aspect-fit.
- Remedies: injunction, damages (including licence-fee analogue), and in
  theory administrative or criminal liability for large-scale wilful
  infringement. Realistic scenario for us is a cease-and-desist letter,
  hence the 24 h kill switch.

### 1c. Takedown process (SOP)

Publish a takedown address on the landing page, in the app settings, and
in the App Store listing support URL. Suggested: `takedown@<domain>.lv`,
forwarded to the personal inbox with a filter and a phone notification.

| Step | Action | SLA |
|------|--------|-----|
| 1 | Acknowledge receipt by email with a ticket number (`TD-YYYYMMDD-n`) | 24 h |
| 2 | Identify the scope: single listing (advertiser), all listings of a source (portal), or a photo (photographer) | same day |
| 3 | Single listing: `update listings set status='rejected', attributes = attributes \|\| '{"reject_reason":"takedown","ticket":"TD-..."}' where source_url = ...`. Also purge it from any future `daily_sets`; if in today's set, swap the item and note it | 24 h from receipt |
| 4 | Whole source: run the kill switch for that `source`, disable the scraper job for that source, and delete cached photo proxies if any exist | 24 h from receipt |
| 5 | Confirm completion to the requester, without arguing. If we believe the request is unfounded, say we complied and ask for a short call | 48 h |
| 6 | Log in `docs/notes/takedowns.md`: date, requester type, scope, action, ticket | same day |
| 7 | Monthly: review the log; three individual requests from one portal is a signal to contact the portal proactively | monthly |

Do not: require proof of ownership for a single-listing removal (cost of
compliance is near zero), reinstate content after a takedown without
written permission, or reply from a personal address.

Also honour requests where a person wants their *guess history* deleted:
that is a GDPR request and follows section 3.

## 2. Scraping conduct

- Respect robots.txt, low rate, identify a contact in the User-Agent
  (`UzminiCenuBot/1.0 (+mailto:...)`). Stop on any block.
- Never circumvent captchas or blocks, never use proxy rotation. That is
  where "scraping" turns into "unauthorised access" (Latvian Criminal Law
  Section 241, and the EU NIS/Cybercrime framework).
- Keep the probe and scraper logs for 12 months as evidence of good
  conduct.

## 3. Personal data (GDPR)

- Listings contain phone numbers and names. Strip them at ingestion and
  never store them. Location at district level only.
- App users: Sign in with Apple gives minimal data. Privacy policy, data
  deletion in-app (App Store requires it), PostHog EU, Supabase EU.
- Push tokens are personal data; delete on account deletion.
- Controller: the developer as a natural person (or SIA once formed).
  Register nothing with the Datu valsts inspekcija in advance (no
  registration duty under GDPR), but keep a record of processing
  (Art. 30); the data map below is that record.
- Processors and their DPAs: Supabase (EU Frankfurt, DPA in their terms),
  PostHog EU, Sentry (US company, EU data residency option must be
  selected; SCCs), Expo push service (US; tokens transit through it;
  SCCs via Expo terms), RevenueCat (US; SCCs), Google AdMob (US; own
  consent framework via UMP), Apple.
- Legal basis for ads: consent via UMP / ATT for personalised ads;
  legitimate interest is not enough for personalised ads in the EU.
  Non-personalised ads still use device identifiers minimally; UMP covers
  it.
- Children: the game is 4+ in App Store terms but not directed at children.
  We do not knowingly collect children's data; no age gate in v1. Ask the
  lawyer whether Latvian law (13 years for consent under the Personal Data
  Processing Law) requires anything more.

### GDPR data map (Art. 30 record)

| Data item | Purpose | Legal basis | Retention | Location / processor |
|-----------|---------|-------------|-----------|----------------------|
| Anonymous user id (Supabase anon session uuid) | play, keep local progress | legitimate interest (service operation) | until account deletion or 12 months inactive | Supabase EU |
| Apple user identifier, email (may be Apple relay) | account, login | contract (Art. 6(1)(b)) | until account deletion | Supabase EU |
| Username, avatar choice, language | profile, leaderboards, friends | contract | until account deletion | Supabase EU |
| Guesses (listing id, guess, score, mode, timestamp) | scoring, leaderboards, stats | contract | until account deletion; anonymised aggregates kept indefinitely | Supabase EU |
| Friendships | friends features | contract | until either side deletes | Supabase EU |
| Duel and room state | multiplayer | contract | 90 days after finish, then deleted | Supabase EU |
| Expo push token | invites, results, daily reminder | consent (OS permission) + contract | until token invalid or account deletion | Supabase EU; transits Expo (US) and APNs |
| Premium status, RevenueCat app user id, transaction ids (no card data) | entitlement | contract | until account deletion; RevenueCat retains transaction records per their policy | RevenueCat (US, SCCs); Apple |
| Analytics events (event name, screen, anonymised user id, device model, OS, app version, country) | product analytics, retention | legitimate interest; no cross-app tracking; user can opt out in settings | 12 months, then aggregated | PostHog EU |
| Crash reports (stack trace, device, OS, app version, anonymised id) | stability | legitimate interest | 90 days | Sentry (EU residency selected) |
| Advertising identifier (IDFA) and ad interaction data | personalised ads | consent (ATT + UMP) | controlled by Google | Google AdMob (US) |
| Non-personalised ad requests (IP, coarse device info) | show ads | legitimate interest (limited) / consent via UMP | controlled by Google | Google AdMob |
| Referral pairs (v1.1) | referral reward | contract | until account deletion | Supabase EU |
| IP address in server logs | security, abuse prevention | legitimate interest | 30 days | Supabase EU, Fly.io EU |
| Takedown correspondence | legal compliance | legal obligation / legitimate interest | 3 years | email provider |
| Support emails | support | legitimate interest | 2 years | email provider |
| Listing data (no personal data after sanitisation) | game content | n/a (not personal data) | until expired + 90 days | Supabase EU |

Data subject rights: access and export via a support email (manual JSON
export from Supabase in v1), deletion in-app (P2.8), objection to
analytics via a settings toggle. Response within 30 days.

### Privacy policy outline

Publish at `https://<domain>.lv/privacy` in lv and en (ru later). Sections:

1. Who we are and how to contact us (controller name, email, address).
2. What this app does in one paragraph.
3. Data we collect, grouped: account, gameplay, device and analytics,
   advertising, purchases, push. Reference the data map.
4. Why we collect it and the legal basis for each group.
5. Third parties and processors with links to their policies: Apple,
   Supabase, PostHog, Sentry, Expo, RevenueCat, Google AdMob.
6. International transfers and safeguards (SCCs, EU hosting).
7. Retention periods.
8. Your rights (access, rectification, erasure, restriction, portability,
   objection, withdraw consent) and how to exercise them, including in-app
   deletion. Right to complain to the Datu valsts inspekcija.
9. Advertising and tracking: ATT, UMP consent, how to change your choice.
10. Children.
11. Listing content: listings come from public portals, we remove personal
    details, contact for takedowns.
12. Changes to this policy and version date.

### Terms of service outline

Publish at `https://<domain>.lv/terms`. Sections:

1. Acceptance and eligibility (16+ to create an account, or with guardian
   consent per Latvian law; lawyer to confirm).
2. The service: a game showing asking prices from public listings. Not
   valuation advice; prices are as displayed by the source portal at
   scrape time and may be outdated or wrong.
3. Account, username rules (no impersonation, no portal brands, no
   offensive names), our right to rename or suspend.
4. Fair play: no automation, no exploiting bugs; leaderboard removal.
5. Premium subscription: prices, trial, auto-renewal, cancellation via
   Apple, refunds via Apple, EU 14-day withdrawal right and its waiver on
   immediate access to digital content.
6. Third-party content and attribution: listings and photos belong to
   their owners and portals; we link and attribute; takedown contact.
7. User content: usernames and avatars only; licence to display them in
   leaderboards.
8. Intellectual property in the app itself.
9. Disclaimer of warranties and limitation of liability, to the extent
   permitted by Latvian consumer law.
10. Termination.
11. Governing law: Latvia; consumer's local mandatory rights preserved;
    EU ODR platform mention.
12. Contact and changes.

## 4. App Store review

- Apple may ask whether we have rights to the content. Have the answer
  ready: facts + links + attribution, and any partnership letters. Review
  notes text is in 14-app-store-listing.
- Gambling: the game has no wagering. Keep it that way. No real-money
  prizes without a licence. Referral rewards are subscription time, not
  cash.
- Sign in with Apple required if any other third-party login is offered.
- Guideline 5.1.1(v): account deletion in-app is required. P2.8.
- Guideline 3.1.2: subscription terms visible on the paywall.
- Guideline 5.2.2: third-party content requires permission; that is the
  partnership letter or the facts-and-links argument.

### App Store privacy nutrition label answers

Based on the data map. "Linked to you" means tied to an account identity.
Review after adding any SDK.

| Data type | Collected | Linked to user | Used for tracking | Purposes |
|-----------|-----------|----------------|-------------------|----------|
| Contact info: email address | Yes (via Sign in with Apple, may be relay) | Yes | No | App functionality |
| Contact info: name | No (we do not request name scope) | - | - | - |
| Identifiers: user id | Yes | Yes | No | App functionality, analytics |
| Identifiers: device id (IDFA) | Yes, only if ATT consent | No | **Yes** | Third-party advertising |
| Purchases: purchase history | Yes | Yes | No | App functionality |
| Usage data: product interaction | Yes | Yes (pseudonymous id) | No | Analytics, app functionality |
| Usage data: advertising data | Yes | No | Yes (if ATT consent) | Third-party advertising |
| Diagnostics: crash data, performance data | Yes | No | No | App functionality |
| User content: other (username, avatar choice) | Yes | Yes | No | App functionality |
| User content: photos or videos | No | - | - | - |
| Location: coarse / precise | No (region filter is a user choice, not device location) | - | - | - |
| Contacts | No | - | - | - |
| Search history | No | - | - | - |
| Financial info | No (Apple handles payment) | - | - | - |
| Health, fitness, sensitive info | No | - | - | - |

Because IDFA is used for tracking when consent is given, the label must
declare "Data Used to Track You"; ATT prompt is mandatory. If we drop
personalised ads, the label simplifies and ATT is not needed.

### Age rating reasoning

Apple's questionnaire answers:

| Question | Answer | Reasoning |
|----------|--------|-----------|
| Cartoon or fantasy violence, realistic violence | None | |
| Profanity or crude humour | None | titles are scrubbed; `random` category excludes adult and offensive content at ingestion; if a bad item slips through it is a curation bug, not a feature |
| Mature / suggestive themes | None | adult listings excluded |
| Horror / fear themes | None | |
| Medical / treatment info | None | |
| Alcohol, tobacco, drug use | None | listings of alcohol are excluded from `random` to be safe |
| Simulated gambling | **None** | guessing a price for points with no stake and no prize of value is a skill quiz, not simulated gambling; keep prizes non-monetary |
| Sexual content or nudity | None | |
| Contests | None in v1 | leaderboards are not contests with prizes; if sponsored sets ever offer prizes, revisit and check Latvian lottery law |
| Unrestricted web access | No | "open listing" opens Safari via the system, not an in-app browser with free navigation; if we use an in-app browser, still "No" since it is a fixed URL |
| Gambling (real money) | No | |
| Made for Kids | No | |

Resulting rating: **4+**. User-facing positioning is 16+ for accounts (terms)
because of ads and account data, but the content rating stays 4+.
Third-party ads via AdMob must be configured with max ad content rating
`G` or `PG` and `tagForUnderAgeOfConsent` off, since the app is not child
directed.

## 5. Operational risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| SS.com changes HTML | scraper breaks, no fresh content | keep 2 weeks of listings, alert on zero new rows |
| SS.com blocks hotlinked photos | rounds show no images | proxy cache with 24 h TTL as emergency, then talk to them; re-open the legal question (1b) |
| Legal letter from a portal | must remove content | kill switch per source, multiple sources, takedown SOP |
| Individual advertiser complaint | one listing removed, reputational | takedown SOP, PII scrub means we rarely expose anyone |
| Low retention | game dies quietly | daily challenge + friends from day one, interview early players |
| App Store rejection on 5.2.2 | launch delay | review notes ready, partnership letters, fallback to numbers-only mode |
| Solo dev burnout | | scope discipline, party rooms and Android are v1.1 |

## 6. Questions for the lawyer (1 hour, P0.6)

Send this list two days before the call.

1. Given *CV-Online Latvia v Melons* and *Innoweb*, how do Latvian courts
   currently treat a nightly scraper that displays a small slice of a
   classifieds database with link-back and attribution? Is the traffic
   argument credible?
2. Hotlinking photos from the portal CDN with attribution, no storage on
   our side, no circumvention: infringement under Latvian Copyright Law,
   and does *VG Bild-Kunst* change that if they add a Referer check?
3. If we instead cache photos for 24 h on our server to survive CDN
   changes, how much worse is our position?
4. Does the `random` category (household items, low-value goods) change
   anything, or is it the same analysis as flats?
5. Minimum content of a written permission from a portal that would
   protect us: who signs, which rights (display, hotlink, cache), term,
   termination notice, attribution requirements. Can you draft a one-page
   template?
6. If SS.com never replies, is silence after a good-faith letter worth
   anything, or does it make our position worse (knowledge)?
7. Using "SS" or "SS.com" in marketing copy, keywords, or in the reveal
   button "Open on SS.com": nominative use OK, or trademark risk?
8. The furniture shop's "Uzmini cenu" campaign: any trademark filing? Any
   risk in using the same phrase as an app name? Should we file a Latvian
   word mark ourselves (cost, timeline)?
9. Should the developer operate as a natural person or set up an SIA
   before launch, given ad and subscription income, VAT (Apple handles VAT
   on sales; what about AdMob payouts), and liability exposure?
10. Privacy: is the data map complete for Art. 30? Anything in Latvian law
    beyond GDPR (Fizisko personu datu apstrādes likums) that affects us,
    e.g. age of digital consent?
11. Terms of service: 16+ for accounts acceptable? Any mandatory Latvian
    consumer-law wording for auto-renewing subscriptions beyond what Apple
    requires?
12. Takedown SOP: is 24 h compliance without proof of ownership sensible,
    or does it create an obligation we cannot always meet?
13. Sponsored daily sets: is a labelled sponsored set "advertising" under
    the Latvian Advertising Law (Reklāmas likums) and what labelling text
    is required in Latvian?
14. Leaderboards with a future prize (say, a €50 voucher from a sponsor):
    lottery / gambling licence implications under Latvian law, and the
    threshold below which it is fine.
15. Scraping the Kadastrs / Zemesgrāmata sale data: open-data licence terms
    and any personal-data issue with property sale records.
16. Anything in the emails to SS.com / City24 (08-roadmap P0.3) that should
    be reworded before sending?
