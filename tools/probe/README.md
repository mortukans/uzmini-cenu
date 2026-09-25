# Phase 0 probe (roadmap P0.1)

Throwaway CLI that measures what `docs/08-roadmap.md` § "P0.1 probe script
plan" lists, and produces the numbers for `docs/notes/ss-probe.md`. Never
shipped, never scheduled. Runs from your home IP.

## Setup

```bash
cd tools/probe
npm install
```

Set a real contact address for the User-Agent (the run refuses to start
without it):

```powershell
$env:PROBE_MAILTO = "you@yourdomain.lv"
```

Node 22.18+ or 24 runs the `.ts` file directly, no build step.

## Evening 1 (about 40 minutes of wall time, mostly waiting)

| Step | Command | Requests | Fills in |
|------|---------|----------|----------|
| 1 | `npm run robots` | 2 | §0 robots re-check |
| 2 | `npm run discover` | ~36 at 5 s | §2 HTML, §4 quality sample, PII |
| 3 | open `out/raw/*.html` in an editor | 0 | the **verify** selectors in `docs/12` (`tr_`, `ads_opt`, `ads_price`, `msg_div_msg`) |
| 4 | `npm run rate -- --interval 5 --n 50` | 50 | §1 row 5.0 s |
| 5 | `npm run rate -- --interval 2.5 --n 50` | 50 | §1 row 2.5 s |
| 6 | `npm run rate -- --interval 1 --n 50` | 50 | §1 row 1.0 s |
| 7 | only if 6 was clean: `npm run rate -- --interval 0.5 --n 30` | 30 | §1 row 0.5 s |
| 8 | `npm run hotlink` | ~21 | §3 |
| 9 | `npm run report` | 0 | `out/report.md` with tables to paste |

After fixing a parser, `node probe.ts reparse` re-runs the analysers over
`out/raw/*.html` with no network. `node probe.ts discover -- --category random`
re-fetches one category and merges it into `discover.json`.

**First run: 2026-09-25.** Results are in `docs/notes/ss-probe.md`.

Optional: `npm run rate -- --interval 2.5 --n 20 --browser-ua` to compare an
iPhone Safari User-Agent against the honest bot UA (§1 "browser-like UA").

If any step prints `⛔ BLOCK SIGNAL`, stop for the day. Record the status,
body size and text in §1. Do not switch IP or UA to get around it. Add
`--recover` to a `rate` run only if you want the 10 / 60 / 600 s recovery
measurement after a block, and only once.

## Day 2 and day 4

```bash
npm run recheck
```

Re-fetches every detail page from `discover` plus the first photo of each,
reports how many expired and how expiry looks (404, redirect, page text), and
whether photos survive removal. Fills §5 and the 24 h / 72 h rows of §3.

## Day 2 also: manual items the script cannot do

- Log in to SS.com in a browser and compare one list page and one detail
  page to the saved anonymous HTML (§1 "logged-in delta").
- City24: two page loads with DevTools open, record the XHR (§6). Do not
  script anything against City24; see `docs/12` for why.
- The iPhone / expo-image hotlink row in §3 waits for the first dev build (P0.7).

## Output

```
out/
  robots.json
  discover.json          list + detail analyses, full fetch log
  rate-<interval>s-<ua>-<stamp>.json
  hotlink.json
  recheck-<hours>h-<stamp>.json
  report.md              generated summary tables
  raw/                   every fetched HTML page, one file per URL
```

`out/` is git-ignored. Copy the numbers into `docs/notes/ss-probe.md`, then
delete `out/raw` (it contains other people's ad text).

## What it deliberately does not do

- No retries after a block, no proxies, no IP rotation.
- Never requests `/en/`, `/photo/`, `*_f/` or filter URLs (robots-disallowed).
- Never calls the phone-reveal endpoint.
- Does not store descriptions; only their length.
