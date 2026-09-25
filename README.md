# Uzmini Cenu (working title)

A "guess the price" game for the Latvian market. Players see real listings from
Latvian portals (flats, houses, cars, random items) and guess the asking price.
Solo, daily challenge, and real-time multiplayer with friends.

iOS first (via EAS cloud build, no Mac), Android second. Stack: Expo / React
Native / TypeScript + Supabase.

## Planning docs

| # | Doc | What it covers |
|---|-----|----------------|
| 01 | [Product vision](docs/01-product-vision.md) | Concept, audience, competitors, differentiation |
| 02 | [Game design](docs/02-game-design.md) | Modes, rounds, scoring, hints, categories |
| 03 | [Data pipeline](docs/03-data-pipeline.md) | Sources, scraper, freshness, quality filters |
| 04 | [Technical architecture](docs/04-technical-architecture.md) | App, backend, realtime, push, build/release |
| 05 | [Data model](docs/05-data-model.md) | Postgres schema and RLS |
| 06 | [Multiplayer](docs/06-multiplayer.md) | Lobby, duel, party protocol |
| 07 | [Monetization & growth](docs/07-monetization-growth.md) | Ads, premium, sharing loop |
| 08 | [Roadmap](docs/08-roadmap.md) | Phases, milestones, definition of done |
| 09 | [Legal & risks](docs/09-legal-risks.md) | Content rights, scraping, GDPR, App Store |
| 10 | [Open questions](docs/10-open-questions.md) | Decisions still to make |
| 11 | [Screens & UX](docs/11-screens-ux.md) | Every screen, wireframes, navigation map, analytics events |
| 12 | [SS.com scraper spec](docs/12-ss-scraper-spec.md) | URL tree, page structure, field mapping, robots.txt, City24 notes |
| 13 | [Testing & QA](docs/13-testing-qa.md) | Unit, integration, Maestro E2E, TestFlight beta, release checklist |
| 14 | [App Store listing](docs/14-app-store-listing.md) | Names, descriptions lv/en, keywords, screenshots, review notes |
| — | [Probe template](docs/notes/ss-probe.md) | Fill-in sheet for the Phase 0 SS.com scrape probe |

## Status

Planning, detailed (≈6,000 lines across 15 docs, 2026-09-25). No code yet.
Next concrete step: Phase 0 in the roadmap (scrape probe, partnership emails,
Apple Developer enrolment, name).

## Reading order

Vision (01) → Game design (02) → Screens (11) → Roadmap (08). Then the
technical docs (03-06, 12) when starting Phase 1.

## Key design decisions

- Prices never reach the client before a guess: signed round tokens, RPCs
  strip `price_eur`, duel/room prices live in a separate `context_prices`
  table so Realtime never leaks them.
- Photos are hotlinked from the portal, not stored, until legal/partnership
  says otherwise. Per-source kill switch exists from day one.
- iOS first via EAS cloud builds (no Mac). Android is v1.1.
- Daily challenge and 1v1 duel ship in v1. Party rooms are v1.1.
