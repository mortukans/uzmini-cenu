#!/usr/bin/env node
/**
 * Uzmini Cenu — Phase 0 probe for SS.com (roadmap P0.1).
 *
 * Throwaway. Measures what docs/08-roadmap.md "P0.1 probe script plan" asks
 * for and writes raw JSON + HTML to ./out so docs/notes/ss-probe.md can be
 * filled in by hand (or via `report`).
 *
 * Discipline rules (docs/09-legal-risks.md):
 *  - honest User-Agent with contact e-mail (set PROBE_MAILTO)
 *  - serial requests, fixed interval, single IP
 *  - on 403 / 429 / captcha / suspicious redirect: STOP. No retries, no proxies.
 *  - never click "Parādīt tālruni", never fetch /en/, /photo/, *_f/ paths
 *
 * Run with Node >= 22.18 (type stripping): `node probe.ts <command>`
 *
 * Commands
 *   robots                       fetch www.ss.com + i.ss.com robots.txt, print relevant rules
 *   discover [--interval 5]      fetch sample list + detail pages per category, analyse HTML, save raw
 *   rate --interval 2.5 [--n 50] fetch N detail URLs (from discover) at interval; stop on first block
 *        [--recover]             after a block, wait 10 / 60 / 600 s and retry once each
 *   hotlink [--n 20]             test photo CDN with no / portal / foreign Referer
 *   recheck                      re-fetch discovered details + photos; report expired (run after 24 h, 72 h)
 *   report                       summarise ./out/*.json into ./out/report.md
 *   selftest                     run the parsers against inline fixture HTML (no network)
 */

import * as cheerio from 'cheerio';
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

// ─── config ──────────────────────────────────────────────────────────────────

const BASE = 'https://www.ss.com';
const OUT = join(import.meta.dirname, 'out');
const RAW = join(OUT, 'raw');
mkdirSync(RAW, { recursive: true });

const MAILTO = process.env.PROBE_MAILTO ?? '';
const NEEDS_NETWORK = !['help', 'report', 'selftest', 'reparse'].includes(process.argv[2] ?? 'help');
if (!MAILTO && NEEDS_NETWORK) {
  console.error('⚠  PROBE_MAILTO is not set. Set it so the User-Agent carries a real contact address:');
  console.error('   PowerShell:  $env:PROBE_MAILTO = "you@example.lv"');
  process.exit(1);
}
const UA = `UzminiCenuProbe/0.1 (+mailto:${MAILTO})`;
const BROWSER_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

/** Sample list pages per category. Plain browse tree only (no _f, no filters). */
const SAMPLE_LISTS: Record<string, string[]> = {
  flats: [
    `${BASE}/lv/real-estate/flats/riga/purvciems/sell/`,
    `${BASE}/lv/real-estate/flats/riga/centre/sell/`,
  ],
  houses: [`${BASE}/lv/real-estate/homes-summer-residences/riga-region/all/sell/`],
  cars: [`${BASE}/lv/transport/cars/audi/sell/`, `${BASE}/lv/transport/cars/volkswagen/sell/`],
  random: [`${BASE}/lv/home-stuff/furniture-interior/chairs/sell/`, `${BASE}/lv/home-stuff/furniture-interior/carpets/sell/`],
};
const DETAILS_PER_CATEGORY: Record<string, number> = { flats: 10, houses: 5, cars: 10, random: 5 };

/** Detail-page labels we care about (docs/12-ss-scraper-spec.md field mapping). */
const KNOWN_LABELS = new Set([
  'Pilsēta', 'Rajons', 'Pagasts', 'Iela', 'Istabas', 'Platība', 'Stāvs', 'Stāvi', 'Sērija', 'Mājas tips',
  'Ērtības', 'Zemes platība', 'Cena',
  'Marka', 'Modelis', 'Izlaiduma gads', 'Motors', 'Ātrumkārba', 'Nobraukums, km', 'Krāsa', 'Virsbūves tips',
  'Vietu skaits', 'Tehniskā apskate',
  'Stāvoklis', 'Ražotājs', 'Tips', 'Materiāls', 'Vieta', 'Uzņēmums', 'VIN kods', 'Valsts numura zīme',
  // houses (observed 2026-09-25)
  'Pilsēta/pagasts', 'Pilsēta, rajons', 'Ciems', 'Stāvu skaits', 'Kadastra numurs',
  // random / furniture
  'Platums x Garums',
]);
const BLOCK_WORDS = ['captcha', 'g-recaptcha', 'cf-challenge', 'access denied', 'jūs esat bloķēts', 'too many requests'];

// ─── tiny arg parser ─────────────────────────────────────────────────────────

const [, , command = 'help', ...rest] = process.argv;
const args: Record<string, string | boolean> = {};
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (a.startsWith('--')) {
    const next = rest[i + 1];
    if (next && !next.startsWith('--')) { args[a.slice(2)] = next; i++; } else args[a.slice(2)] = true;
  }
}
const num = (k: string, d: number) => (typeof args[k] === 'string' ? Number(args[k]) : d);

// ─── fetch with politeness + block detection ─────────────────────────────────

interface FetchLog {
  url: string; status: number; ms: number; bytes: number; contentType: string | null;
  location: string | null; blocked: boolean; blockReason?: string; at: string; ua: 'bot' | 'browser';
  headers?: Record<string, string>;
}
const fetchLog: FetchLog[] = [];
let lastRequestAt = 0;

function detectBlock(url: string, status: number, body: string, location: string | null): string | undefined {
  if ([403, 429].includes(status)) return `status ${status}`;
  if (status === 503 && body.length < 5000) return 'status 503 small body';
  const lower = body.slice(0, 200_000).toLowerCase();
  const w = BLOCK_WORDS.find((x) => lower.includes(x));
  if (w) return `body contains "${w}"`;
  if (location) {
    const from = new URL(url).pathname.split('/').slice(0, 3).join('/');
    const to = new URL(location, url).pathname;
    if (!to.startsWith(from) && !to.startsWith('/msg/')) return `redirect out of path family → ${to}`;
  }
  return undefined;
}

async function polite(url: string, opts: { intervalS?: number; ua?: 'bot' | 'browser'; referer?: string; method?: 'GET' | 'HEAD'; expectHtml?: boolean } = {}) {
  const interval = (opts.intervalS ?? 5) * 1000;
  const jitter = interval * 0.2 * (Math.random() - 0.5);
  const wait = lastRequestAt + interval + jitter - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();

  const headers: Record<string, string> = {
    'User-Agent': opts.ua === 'browser' ? BROWSER_UA : UA,
    'Accept-Language': 'lv,en;q=0.5',
    Accept: opts.expectHtml === false ? '*/*' : 'text/html,application/xhtml+xml,*/*;q=0.8',
  };
  if (opts.referer) headers.Referer = opts.referer;

  const t0 = performance.now();
  let res: Response;
  try {
    res = await fetch(url, { headers, method: opts.method ?? 'GET', redirect: 'manual', signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    const entry: FetchLog = { url, status: 0, ms: Math.round(performance.now() - t0), bytes: 0, contentType: null, location: null, blocked: false, blockReason: `network: ${(e as Error).message}`, at: new Date().toISOString(), ua: opts.ua ?? 'bot' };
    fetchLog.push(entry);
    return { ...entry, body: '' };
  }
  const body = opts.method === 'HEAD' ? '' : await res.text();
  const location = res.headers.get('location');
  const reason = detectBlock(url, res.status, body, location);
  const entry: FetchLog = {
    url, status: res.status, ms: Math.round(performance.now() - t0), bytes: body.length || Number(res.headers.get('content-length') ?? 0),
    contentType: res.headers.get('content-type'), location, blocked: !!reason, blockReason: reason, at: new Date().toISOString(), ua: opts.ua ?? 'bot',
    headers: Object.fromEntries(['cache-control', 'expires', 'last-modified', 'etag', 'content-length', 'content-type', 'server', 'set-cookie'].map((h) => [h, res.headers.get(h) ?? '']).filter(([, v]) => v)),
  };
  fetchLog.push(entry);
  console.log(`${entry.status} ${String(entry.ms).padStart(5)}ms ${String(entry.bytes).padStart(7)}B  ${url}${reason ? `   ⛔ ${reason}` : ''}`);
  return { ...entry, body };
}

class Blocked extends Error {}
function abortIfBlocked(r: FetchLog) {
  if (r.blocked) {
    console.error(`\n⛔ BLOCK SIGNAL: ${r.blockReason} on ${r.url}\n   Stopping now. Do not retry today, do not change IP. Record this in ss-probe.md §1.`);
    throw new Blocked(r.blockReason);
  }
}

const save = (name: string, data: unknown) => writeFileSync(join(OUT, name), JSON.stringify(data, null, 2));
const load = <T>(name: string): T | null => (existsSync(join(OUT, name)) ? (JSON.parse(readFileSync(join(OUT, name), 'utf8')) as T) : null);
const slug = (url: string) => url.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '_').slice(0, 120);
const saveRaw = (url: string, html: string) => writeFileSync(join(RAW, `${slug(url)}.html`), html);

// ─── HTML analysis ───────────────────────────────────────────────────────────

interface ListRow { sourceUrl: string; rowId: string | null; rowClass: string | null; linkClass: string | null; linkId: string | null; cells: string[]; thumb: string | null }
interface ListAnalysis {
  url: string; category: string; headers: string[]; rows: ListRow[]; rowCount: number;
  idPrefixes: Record<string, number>; classCounts: Record<string, number>; pagination: string[]; rssLink: string | null;
}

function analyseList(url: string, category: string, html: string): ListAnalysis {
  const $ = cheerio.load(html);
  const rows: ListRow[] = [];
  const idPrefixes: Record<string, number> = {};
  const classCounts: Record<string, number> = {};
  const bump = (m: Record<string, number>, k: string) => (m[k] = (m[k] ?? 0) + 1);

  // Walk from each ad link to its *nearest* <tr>, so outer wrapper rows of nested tables are not counted as ads.
  const seenTr = new Set<unknown>();
  $('a[href*="/msg/lv/"]').each((_, aEl) => {
    const $tr = $(aEl).closest('tr');
    if (!$tr.length || seenTr.has($tr[0])) return;
    seenTr.add($tr[0]);
    // the title link is the one with text; thumbnail links have only an <img>
    const a = $tr.find('a[href*="/msg/lv/"]').filter((_, x) => $(x).text().trim().length > 0).first().length
      ? $tr.find('a[href*="/msg/lv/"]').filter((_, x) => $(x).text().trim().length > 0).first()
      : $(aEl);
    const href = a.attr('href')!;
    const id = $tr.attr('id') ?? null;
    if (id) bump(idPrefixes, id.replace(/[0-9a-z]{5,}$/i, '*').replace(/\d+/g, 'N'));
    $tr.children('td').each((_, td) => { const c = $(td).attr('class'); if (c) c.split(/\s+/).forEach((x) => bump(classCounts, `td.${x}`)); });
    const lc = a.attr('class'); if (lc) bump(classCounts, `a.${lc}`);
    rows.push({
      sourceUrl: new URL(href, BASE).toString(), rowId: id, rowClass: $tr.attr('class') ?? null,
      linkClass: lc ?? null, linkId: a.attr('id') ?? null,
      cells: $tr.children('td').map((_, td) => $(td).text().replace(/\s+/g, ' ').trim()).get().filter(Boolean),
      thumb: $tr.find('img').first().attr('src') ?? null,
    });
  });
  // header row = the row that contains a "Cena" cell but no /msg/ link
  let headers: string[] = [];
  $('tr').each((_, tr) => {
    const t = $(tr).find('td,th').map((_, c) => $(c).text().replace(/\s+/g, ' ').trim()).get();
    if (t.includes('Sludinājumi') && t.some((x) => /^Cena/.test(x)) && !$(tr).find('a[href*="/msg/"]').length && !$(tr).find('tr').length && !headers.length) headers = t;
  });
  const pagination = $('a[href*="page"]').map((_, a) => $(a).attr('href')!).get().filter((h) => /page\d+\.html$/.test(h));
  const rssLink = $('a[href*="/rss/"]').first().attr('href') ?? null;
  return { url, category, headers, rows, rowCount: rows.length, idPrefixes, classCounts, pagination: [...new Set(pagination)], rssLink };
}

interface DetailAnalysis {
  url: string; category: string; attrs: Record<string, string>; unknownLabels: string[]; priceText: string | null; priceEur: number | null;
  dealFromPrice: string; breadcrumb: string[]; photos: string[]; photoDirs: number; descriptionLength: number;
  selectors: Record<string, number>; pii: { phonesMasked: number; phonesFull: number; emails: number };
  postedAt: string | null; locationText: string | null;
}

function parsePrice(text: string | null): { eur: number | null; deal: string } {
  if (!text) return { eur: null, deal: 'price_missing' };
  const t = text.toLowerCase();
  if (/€\s*\/\s*mēn|€\s*\/\s*dien|mēnesī|dienā/.test(t)) return { eur: null, deal: 'rent' };
  if (/pērku|pērk\b/.test(t)) return { eur: null, deal: 'buy' };
  if (/mai[nņ]/.test(t)) return { eur: null, deal: 'change' };
  if (/vienojoties|vienošan/.test(t)) return { eur: null, deal: 'price_missing' };
  const m = t.match(/([\d\s .,]+)\s*€/);
  if (!m) return { eur: null, deal: 'price_unparsed' };
  const n = Number(m[1].replace(/[\s .,]/g, ''));
  return Number.isFinite(n) && n > 0 ? { eur: n, deal: 'sell' } : { eur: null, deal: 'price_unparsed' };
}

function analyseDetail(url: string, category: string, html: string): DetailAnalysis {
  const $ = cheerio.load(html);
  const attrs: Record<string, string> = {};
  const unknown: string[] = [];
  $('tr').each((_, tr) => {
    const tds = $(tr).children('td');
    if (tds.length !== 2) return;
    const label = $(tds[0]).text().replace(/\s+/g, ' ').trim().replace(/:$/, '');
    const value = $(tds[1]).text().replace(/\s+/g, ' ').trim().replace(/\s*Aprēķināt apdrošināšanu.*$/, '').replace(/\s*\[Karte\]$/, '');
    if (!label || label.length > 40 || !value) return;
    if (KNOWN_LABELS.has(label)) attrs[label] = value;
    else if (/^[A-ZĀČĒĢĪĶĻŅŠŪŽ][^.]{1,30}$/.test(label)) unknown.push(label);
  });
  const priceText = attrs['Cena'] ?? ($('td.ads_price').first().text().replace(/\s+/g, ' ').trim() || null);
  const { eur, deal } = parsePrice(priceText);

  const photos = new Set<string>();
  const dirs = new Set<string>();
  $('img[src*="i.ss.com/gallery"], a[href*="i.ss.com/gallery"]').each((_, el) => {
    const src = $(el).attr('src') ?? $(el).attr('href')!;
    const m = src.match(/(https?:\/\/i\.ss\.com\/gallery\/\d+\/\d+\/(\d+)\/[^/]+?)\.(th2|t|800)\.jpg/);
    if (m) { photos.add(`${m[1]}.800.jpg`); dirs.add(m[2]); }
  });

  $('script, style').remove(); // a page-view counter constant "232-26935-..." looks like a phone number otherwise
  const text = $('body').text();
  const breadcrumb = $('a[href*="/lv/"]').filter((_, a) => /\/(sell|buy|hand_over|rent|change|other)\/$/.test($(a).attr('href') ?? '')).map((_, a) => $(a).text().trim()).get();
  const selectors: Record<string, number> = {
    '#msg_div_msg': $('#msg_div_msg').length, 'td.ads_opt_name': $('td.ads_opt_name').length, 'td.ads_opt': $('td.ads_opt').length,
    'td.ads_price': $('td.ads_price').length, '.ads_photo_label': $('.ads_photo_label').length, '#msg_div_msg text': $('#msg_div_msg').text().length,
  };
  const desc = $('#msg_div_msg').text() || '';
  const pii = {
    phonesMasked: (text.match(/\(\+371\)\s*\d{2}-\d{2}-\*{3}|\d{2}-\d{2}-\*{3}/g) ?? []).length,
    // LV mobile: 8 digits starting with 2, optional +371, optional grouping; excludes masked "***" numbers
    phonesFull: (text.match(/(?:\+371\s?)?\b2\d(?:[\s-]?\d){6}\b/g) ?? []).filter((s) => !s.includes('*') && s.replace(/\D/g, '').replace(/^371/, '').length === 8).length,
    emails: (text.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? []).filter((e) => !e.includes(MAILTO)).length,
  };
  const posted = text.match(/Datums:\s*(\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2})/);
  const loc = attrs['Vieta'] ?? null; // "Rīga", "Talsi un raj." — present on flats and cars

  return {
    url, category, attrs, unknownLabels: [...new Set(unknown)].slice(0, 30), priceText, priceEur: eur, dealFromPrice: deal, breadcrumb,
    photos: [...photos], photoDirs: dirs.size, descriptionLength: desc.length, selectors, pii, postedAt: posted?.[1] ?? null, locationText: loc,
  };
}

// ─── commands ────────────────────────────────────────────────────────────────

async function cmdRobots() {
  const out: Record<string, unknown> = {};
  for (const host of ['https://www.ss.com', 'https://i.ss.com']) {
    const r = await polite(`${host}/robots.txt`, { intervalS: 2, expectHtml: false });
    const lines = r.body.split('\n').map((l) => l.trim()).filter(Boolean);
    const relevant = lines.filter((l) => /^(user-agent|crawl-delay|sitemap)/i.test(l) || /\/(lv|msg|real-estate|transport|photo|_f|rss|en)\b/.test(l));
    out[host] = { status: r.status, lines: lines.length, relevant, disallowCount: lines.filter((l) => /^disallow/i.test(l)).length };
    console.log(`\n${host}/robots.txt → ${r.status}, ${lines.length} lines, ${out[host]['disallowCount']} Disallow. Relevant:`);
    relevant.forEach((l) => console.log('   ' + l));
    saveRaw(`${host}/robots.txt`, r.body);
  }
  // Which of our planned paths are disallowed for *?
  save('robots.json', { at: new Date().toISOString(), ...out, plannedPaths: Object.values(SAMPLE_LISTS).flat() });
  console.log('\nSaved out/robots.json. Compare planned paths against Disallow lines by eye (docs/12 has the 2026-09-25 baseline).');
}

async function cmdDiscover() {
  const interval = num('interval', 5);
  // --category flats,cars : re-run only those categories and merge into the existing discover.json
  const only = typeof args['category'] === 'string' ? String(args['category']).split(',') : null;
  const prev = only ? load<{ lists: ListAnalysis[]; details: DetailAnalysis[] }>('discover.json') : null;
  const lists: ListAnalysis[] = prev ? prev.lists.filter((l) => !only!.includes(l.category)) : [];
  const details: DetailAnalysis[] = prev ? prev.details.filter((d) => !only!.includes(d.category)) : [];
  try {
    for (const [category, urls] of Object.entries(SAMPLE_LISTS)) {
      if (only && !only.includes(category)) continue;
      for (const url of urls) {
        let r = await polite(url, { intervalS: interval });
        abortIfBlocked(r);
        saveRaw(url, r.body);
        let la = analyseList(url, category, r.body);
        if (la.rowCount === 0) {
          // category/region index without ads: follow the first sub-link that ends in /sell/
          const $ = cheerio.load(r.body);
          const prefix = new URL(url).pathname.replace(/sell\/$/, '');
          const sub = $('a[href]').map((_, a) => $(a).attr('href')!).get().find((h) => h.startsWith(prefix) && h !== prefix && /\/sell\/$/.test(h) && !/_f\/|fDg/.test(h));
          if (sub) {
            console.log(`   ↳ index page, following ${sub}`);
            r = await polite(new URL(sub, BASE).toString(), { intervalS: interval });
            abortIfBlocked(r);
            saveRaw(r.url, r.body);
            la = analyseList(r.url, category, r.body);
          }
        }
        lists.push(la);
        console.log(`   ↳ ${la.rowCount} rows, headers: ${la.headers.join(' | ') || '(none found)'}, id prefixes: ${JSON.stringify(la.idPrefixes)}`);
      }
      const want = DETAILS_PER_CATEGORY[category];
      const candidates = lists.filter((l) => l.category === category).flatMap((l) => l.rows).map((r) => r.sourceUrl);
      const picked = [...new Set(candidates)].sort(() => Math.random() - 0.5).slice(0, want);
      for (const url of picked) {
        const r = await polite(url, { intervalS: interval });
        abortIfBlocked(r);
        saveRaw(url, r.body);
        const da = analyseDetail(url, category, r.body);
        details.push(da);
        console.log(`   ↳ price=${da.priceText ?? '∅'} → ${da.priceEur ?? '∅'} (${da.dealFromPrice}), photos=${da.photos.length} in ${da.photoDirs} dir(s), attrs=${Object.keys(da.attrs).length}, sel=${JSON.stringify(da.selectors)}`);
      }
    }
  } catch (e) {
    if (!(e instanceof Blocked)) throw e;
  } finally {
    save('discover.json', { at: prev ? (load<{ at: string }>('discover.json')?.at ?? new Date().toISOString()) : new Date().toISOString(), interval, lists, details, fetchLog });
    printDiscoverSummary(lists, details);
  }
}

function printDiscoverSummary(lists: ListAnalysis[], details: DetailAnalysis[]) {
  console.log('\n════════ DISCOVER SUMMARY ════════');
  for (const l of lists) console.log(`${l.category.padEnd(7)} ${l.rowCount.toString().padStart(3)} rows  pages≈${l.pagination.length}  rss=${l.rssLink ?? '—'}  classes=${Object.keys(l.classCounts).slice(0, 6).join(',')}  ${l.url}`);
  const byCat = Object.groupBy(details, (d) => d.category);
  for (const [cat, ds] of Object.entries(byCat)) {
    if (!ds) continue;
    const labels: Record<string, number> = {};
    ds.forEach((d) => Object.keys(d.attrs).forEach((k) => (labels[k] = (labels[k] ?? 0) + 1)));
    const n = ds.length;
    console.log(`\n${cat}: ${n} details`);
    console.log(`  price parsed     ${ds.filter((d) => d.priceEur).length}/${n}   deals: ${JSON.stringify(Object.fromEntries(Object.entries(Object.groupBy(ds, (d) => d.dealFromPrice)).map(([k, v]) => [k, v!.length])))}`);
    console.log(`  photos ≥2        ${ds.filter((d) => d.photos.length >= 2).length}/${n}   histogram: ${JSON.stringify(Object.fromEntries(Object.entries(Object.groupBy(ds, (d) => Math.min(d.photos.length, 10))).map(([k, v]) => [k, v!.length])))}   multi-dir: ${ds.filter((d) => d.photoDirs > 1).length}`);
    console.log(`  label coverage   ${Object.entries(labels).map(([k, v]) => `${k}=${v}`).join('  ')}`);
    console.log(`  unknown labels   ${[...new Set(ds.flatMap((d) => d.unknownLabels))].slice(0, 15).join(', ') || '—'}`);
    console.log(`  selectors hit    ${JSON.stringify(ds[0].selectors)}`);
    console.log(`  PII              masked=${ds.reduce((s, d) => s + d.pii.phonesMasked, 0)} full=${ds.reduce((s, d) => s + d.pii.phonesFull, 0)} emails=${ds.reduce((s, d) => s + d.pii.emails, 0)}`);
    console.log(`  posted parsed    ${ds.filter((d) => d.postedAt).length}/${n}${cat === 'cars' ? `   location line: ${ds.filter((d) => d.locationText).length}/${n}` : ''}`);
  }
  console.log('\nRaw HTML in out/raw/. Open one list + one detail page and fill in the "verify" selectors in docs/12.');
}

async function cmdRate() {
  const interval = num('interval', 2.5);
  const n = num('n', 50);
  const ua = args['browser-ua'] ? 'browser' : 'bot';
  const disc = load<{ details: DetailAnalysis[]; lists: ListAnalysis[] }>('discover.json');
  if (!disc) { console.error('Run `discover` first; rate uses its URLs.'); process.exit(1); }
  const pool = [...new Set(disc.lists.flatMap((l) => l.rows.map((r) => r.sourceUrl)))].sort(() => Math.random() - 0.5);
  const urls = pool.slice(0, n);
  console.log(`Rate test: ${urls.length} detail fetches at ${interval}s (${ua} UA). Ctrl-C any time; log is saved on exit.\n`);
  const runLog: FetchLog[] = [];
  let blocked: FetchLog | null = null;
  const t0 = Date.now();
  try {
    for (const url of urls) {
      const r = await polite(url, { intervalS: interval, ua });
      runLog.push(r);
      if (r.blocked) { blocked = r; abortIfBlocked(r); }
    }
  } catch (e) { if (!(e instanceof Blocked)) throw e; }

  const recovery: { waitedS: number; status: number; blocked: boolean }[] = [];
  if (blocked && args['recover']) {
    for (const w of [10, 60, 600]) {
      console.log(`\nRecovery probe: waiting ${w}s then one request…`);
      await sleep(w * 1000);
      const r = await polite(blocked.url, { intervalS: 0, ua });
      recovery.push({ waitedS: w, status: r.status, blocked: r.blocked });
      if (!r.blocked) { console.log(`   recovered after ${w}s`); break; }
    }
  }
  const ok = runLog.filter((r) => r.status === 200);
  const times = ok.map((r) => r.ms).sort((a, b) => a - b);
  const pct = (p: number) => times[Math.min(times.length - 1, Math.floor(p * times.length))] ?? null;
  const summary = {
    at: new Date().toISOString(), intervalS: interval, ua, requested: urls.length, done: runLog.length, status200: ok.length,
    status403or429: runLog.filter((r) => [403, 429].includes(r.status)).length, other: runLog.filter((r) => ![200, 403, 429].includes(r.status)).map((r) => r.status),
    medianMs: pct(0.5), p95Ms: pct(0.95), elapsedS: Math.round((Date.now() - t0) / 1000),
    firstBlock: blocked ? { url: blocked.url, status: blocked.status, reason: blocked.blockReason, bytes: blocked.bytes, index: runLog.indexOf(blocked) } : null, recovery,
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  save(`rate-${interval}s-${ua}-${stamp}.json`, { summary, runLog });
  console.log('\n════════ RATE SUMMARY ════════');
  console.table([summary]);
  console.log(`Fill into ss-probe.md §1 row "${interval} s".`);
}

async function cmdHotlink() {
  const n = num('n', 20);
  const disc = load<{ details: DetailAnalysis[] }>('discover.json');
  if (!disc) { console.error('Run `discover` first.'); process.exit(1); }
  const photos = [...new Set(disc.details.flatMap((d) => d.photos))].slice(0, n);
  if (!photos.length) { console.error('No photo URLs found in discover.json — check analyseDetail selectors against out/raw first.'); process.exit(1); }
  const cases = [
    { name: 'no referer', referer: undefined },
    { name: 'portal referer', referer: 'https://www.ss.com/' },
    { name: 'foreign referer', referer: 'https://uzminicenu.lv/' },
    { name: 'no referer, browser UA', referer: undefined, ua: 'browser' as const },
  ];
  const results: Record<string, { status: number; contentType: string | null; bytes: number; headers?: Record<string, string> }[]> = {};
  const robots = await polite('https://i.ss.com/robots.txt', { intervalS: 1, expectHtml: false });
  for (const c of cases) {
    results[c.name] = [];
    for (const url of photos.slice(0, Math.max(5, Math.floor(n / cases.length)))) {
      const r = await polite(url, { intervalS: 1.5, referer: c.referer, ua: c.ua, expectHtml: false });
      results[c.name].push({ status: r.status, contentType: r.contentType, bytes: r.bytes, headers: r.headers });
    }
  }
  const summary = Object.fromEntries(Object.entries(results).map(([k, v]) => [k, {
    tested: v.length, ok200: v.filter((x) => x.status === 200 && (x.contentType ?? '').startsWith('image/')).length,
    statuses: [...new Set(v.map((x) => x.status))].join(','), avgKB: Math.round(v.reduce((s, x) => s + x.bytes, 0) / v.length / 1024),
    cacheControl: v[0]?.headers?.['cache-control'] ?? '', expires: v[0]?.headers?.['expires'] ?? '',
  }]));
  save('hotlink.json', { at: new Date().toISOString(), photos, robotsTxt: { status: robots.status, body: robots.body.slice(0, 2000) }, results, summary });
  console.log('\n════════ HOTLINK SUMMARY ════════');
  console.table(summary);
  console.log(`i.ss.com/robots.txt → ${robots.status}\n${robots.body.slice(0, 500)}`);
  console.log('\nFill into ss-probe.md §3. The iPhone/expo-image row still needs a manual test in the dev build.');
}

async function cmdRecheck() {
  const disc = load<{ at: string; details: DetailAnalysis[] }>('discover.json');
  if (!disc) { console.error('Run `discover` first.'); process.exit(1); }
  const hoursSince = Math.round((Date.now() - Date.parse(disc.at)) / 36e5);
  console.log(`Recheck of ${disc.details.length} details discovered ${hoursSince} h ago.\n`);
  const rows: { url: string; status: number; expired: boolean; reason: string; priceNow: number | null; priceThen: number | null; photoStatus: number | null }[] = [];
  try {
    for (const d of disc.details) {
      const r = await polite(d.url, { intervalS: 3 });
      abortIfBlocked(r);
      const text = r.status === 200 ? cheerio.load(r.body)('body').text() : '';
      const gone = r.status === 404 || /nav atrasts|sludinājums (ir )?dzēsts|not found/i.test(text) || (r.status >= 300 && r.status < 400);
      const priceNow = r.status === 200 ? analyseDetail(d.url, d.category, r.body).priceEur : null;
      let photoStatus: number | null = null;
      if (d.photos[0]) { const p = await polite(d.photos[0], { intervalS: 1, method: 'HEAD', expectHtml: false }); photoStatus = p.status; }
      rows.push({ url: d.url, status: r.status, expired: gone, reason: gone ? (r.status === 404 ? '404' : r.location ? `redirect → ${r.location}` : 'page text') : '', priceNow, priceThen: d.priceEur, photoStatus });
    }
  } catch (e) { if (!(e instanceof Blocked)) throw e; }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  save(`recheck-${hoursSince}h-${stamp}.json`, { at: new Date().toISOString(), hoursSince, rows });
  console.log('\n════════ RECHECK SUMMARY ════════');
  console.log(`expired: ${rows.filter((r) => r.expired).length}/${rows.length}   price changed: ${rows.filter((r) => !r.expired && r.priceNow !== r.priceThen).length}   photo still 200 on expired ads: ${rows.filter((r) => r.expired && r.photoStatus === 200).length}/${rows.filter((r) => r.expired).length}`);
  console.log(`expiry symptoms: ${[...new Set(rows.filter((r) => r.expired).map((r) => r.reason))].join(' | ') || '—'}`);
  console.log('Fill into ss-probe.md §5 (and the 24 h / 72 h rows of §3).');
}

function cmdReport() {
  const files = readdirSync(OUT).filter((f) => f.endsWith('.json'));
  const md: string[] = [`# Probe report (generated ${new Date().toISOString()})`, '', 'Paste the relevant numbers into docs/notes/ss-probe.md.', ''];
  const robots = load<Record<string, { relevant?: string[] }>>('robots.json');
  if (robots) { md.push('## robots.txt', ''); for (const [h, v] of Object.entries(robots)) if (v?.relevant) md.push(`**${h}**`, '```', ...v.relevant, '```', ''); }
  const disc = load<{ lists: ListAnalysis[]; details: DetailAnalysis[] }>('discover.json');
  if (disc) {
    md.push('## HTML structure (§2)', '', '| Page | Rows | Headers | Row id prefixes | Cell classes |', '|---|---|---|---|---|');
    for (const l of disc.lists) md.push(`| ${l.category} list | ${l.rowCount} | ${l.headers.join(' / ')} | ${Object.keys(l.idPrefixes).join(', ')} | ${Object.keys(l.classCounts).join(', ')} |`);
    md.push('', '| Category | Details | Price parsed | Photos ≥ 2 | Multi-dir | Labels seen | Selectors hit |', '|---|---|---|---|---|---|---|');
    for (const [cat, ds] of Object.entries(Object.groupBy(disc.details, (d) => d.category))) {
      if (!ds) continue;
      const labels = [...new Set(ds.flatMap((d) => Object.keys(d.attrs)))];
      md.push(`| ${cat} | ${ds.length} | ${ds.filter((d) => d.priceEur).length} | ${ds.filter((d) => d.photos.length >= 2).length} | ${ds.filter((d) => d.photoDirs > 1).length} | ${labels.join(', ')} | ${Object.entries(ds[0].selectors).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'} |`);
    }
    md.push('', `PII: masked phones ${disc.details.reduce((s, d) => s + d.pii.phonesMasked, 0)}, full phones ${disc.details.reduce((s, d) => s + d.pii.phonesFull, 0)}, emails ${disc.details.reduce((s, d) => s + d.pii.emails, 0)}`, '');
  }
  const rates = files.filter((f) => f.startsWith('rate-')).map((f) => load<{ summary: Record<string, unknown> }>(f)!.summary);
  if (rates.length) {
    md.push('## Rate and blocking (§1)', '', '| Interval | UA | Done | 200 | 403/429 | Median ms | p95 ms | First block |', '|---|---|---|---|---|---|---|---|');
    for (const s of rates) md.push(`| ${s.intervalS} s | ${s.ua} | ${s.done}/${s.requested} | ${s.status200} | ${s.status403or429} | ${s.medianMs} | ${s.p95Ms} | ${s.firstBlock ? JSON.stringify(s.firstBlock) : '—'} |`);
    md.push('');
  }
  const hot = load<{ summary: Record<string, Record<string, unknown>> }>('hotlink.json');
  if (hot) { md.push('## Photo hotlinking (§3)', '', '| Test | OK | Statuses | Avg kB | Cache-Control | Expires |', '|---|---|---|---|---|---|'); for (const [k, v] of Object.entries(hot.summary)) md.push(`| ${k} | ${v.ok200}/${v.tested} | ${v.statuses} | ${v.avgKB} | ${v.cacheControl} | ${v.expires} |`); md.push(''); }
  const rechecks = files.filter((f) => f.startsWith('recheck-')).map((f) => load<{ hoursSince: number; rows: { expired: boolean; photoStatus: number | null; reason: string }[] }>(f)!);
  if (rechecks.length) {
    md.push('## Expiry (§5)', '', '| After | Expired | Photos still 200 on expired | Symptoms |', '|---|---|---|---|');
    for (const r of rechecks) { const ex = r.rows.filter((x) => x.expired); md.push(`| ${r.hoursSince} h | ${ex.length}/${r.rows.length} | ${ex.filter((x) => x.photoStatus === 200).length} | ${[...new Set(ex.map((x) => x.reason))].join('; ')} |`); }
    md.push('');
  }
  writeFileSync(join(OUT, 'report.md'), md.join('\n'));
  console.log(md.join('\n'));
  console.log('\nWritten to out/report.md');
}

function cmdSelftest() {
  const listHtml = `<html><body><table>
    <tr><td></td><td>Sludinājumi</td><td>datums</td><td>Iela</td><td>Ist.</td><td>m²</td><td>Stāvs</td><td>Sērija</td><td>Cena, m2</td><td>Cena</td></tr>
    <tr id="tr_77430610"><td class="msga2"><img src="https://i.ss.com/gallery/8/1549/387154/77430610.th2.jpg"></td>
      <td class="msg2"><a class="am" id="dm_77430610" href="/msg/lv/real-estate/flats/riga/purvciems/aemdn.html">Pārdodam 2-istabu dzīvokli</a></td>
      <td class="msga2-o pp6">Dzelzavas 95</td><td class="msga2-o pp6">2</td><td class="msga2-o pp6">50</td><td class="msga2-o pp6">5/5</td><td class="msga2-o pp6">LT proj.</td><td class="msga2-o pp6">1 360 €</td><td class="msga2-o pp6">68 000 €</td></tr>
    <tr id="tr_77431329"><td></td><td><a class="am" href="/msg/lv/real-estate/flats/riga/purvciems/hddnp.html">Izīrē</a></td><td>Staiceles 1</td><td>1</td><td>30</td><td>1/9</td><td>602.</td><td>-</td><td>450 €/mēn.</td></tr>
    <tr><td><a href="/lv/real-estate/flats/riga/purvciems/sell/page2.html">2</a> <a href="/lv/real-estate/flats/riga/purvciems/rss/">RSS</a></td></tr>
  </table></body></html>`;
  const l = analyseList(`${BASE}/lv/real-estate/flats/riga/purvciems/sell/`, 'flats', listHtml);
  const detailHtml = `<html><body>
    <a href="/lv/real-estate/flats/riga/purvciems/sell/">Pārdod</a>
    <div id="msg_div_msg">Pārdodam dzīvokli. Cena 68 000. Zvanīt (+371)26-68-*** <a>Parādīt tālruni</a></div>
    <table>
      <tr><td class="ads_opt_name">Pilsēta:</td><td class="ads_opt">Rīga</td></tr>
      <tr><td class="ads_opt_name">Rajons:</td><td class="ads_opt">Purvciems</td></tr>
      <tr><td class="ads_opt_name">Istabas:</td><td class="ads_opt">2</td></tr>
      <tr><td class="ads_opt_name">Platība:</td><td class="ads_opt">50 m²</td></tr>
      <tr><td class="ads_opt_name">Stāvs:</td><td class="ads_opt">5/5</td></tr>
      <tr><td class="ads_opt_name">Cena:</td><td class="ads_price">68 000 € (1 360 €/m²)</td></tr>
    </table>
    <img src="https://i.ss.com/gallery/8/1549/387154/flats-riga-purvciems-77430610.t.jpg">
    <a href="https://i.ss.com/gallery/8/1549/387157/flats-riga-purvciems-77430611.800.jpg"><img src="https://i.ss.com/gallery/8/1549/387157/flats-riga-purvciems-77430611.t.jpg"></a>
    Datums: 25.09.2026 11:03
  </body></html>`;
  const d = analyseDetail(`${BASE}/msg/lv/real-estate/flats/riga/purvciems/aemdn.html`, 'flats', detailHtml);
  const checks: [string, boolean][] = [
    ['list: 2 rows', l.rowCount === 2],
    ['list: header row found', l.headers.includes('Cena')],
    ['list: tr_ id prefix detected', Object.keys(l.idPrefixes).some((k) => k.startsWith('tr_'))],
    ['list: cells captured', l.rows[0].cells.includes('68 000 €')],
    ['list: pagination + rss', l.pagination.length === 1 && !!l.rssLink],
    ['detail: attrs', d.attrs['Platība'] === '50 m²' && d.attrs['Rajons'] === 'Purvciems'],
    ['detail: price NBSP parsed', d.priceEur === 68000 && d.dealFromPrice === 'sell'],
    ['detail: photos deduped to .800 across 2 dirs', d.photos.length === 2 && d.photoDirs === 2 && d.photos.every((p) => p.endsWith('.800.jpg'))],
    ['detail: selectors hit', d.selectors['td.ads_opt'] === 5 && d.selectors['#msg_div_msg'] === 1],
    ['detail: masked phone counted, no full phone', d.pii.phonesMasked === 1 && d.pii.phonesFull === 0],
    ['detail: posted parsed', d.postedAt === '25.09.2026 11:03'],
    ['detail: breadcrumb deal', d.breadcrumb.includes('Pārdod')],
    ['price: rent', parsePrice('450 €/mēn.').deal === 'rent'],
    ['price: buy', parsePrice('pērku').deal === 'buy'],
    ['price: missing', parsePrice('vienojoties').deal === 'price_missing'],
    ['price: plain', parsePrice('4 700 €').eur === 4700],
  ];
  let fail = 0;
  for (const [name, ok] of checks) { console.log(`${ok ? '✔' : '✘'} ${name}`); if (!ok) fail++; }
  if (fail) { console.log(JSON.stringify({ l: { ...l, rows: l.rows.slice(0, 1) }, d }, null, 2)); process.exit(1); }
  console.log(`
All ${checks.length} checks passed (fixture uses the *presumed* SS class names; real ones are confirmed by \`discover\`).`);
}

// ─── main ────────────────────────────────────────────────────────────────────

/** Re-run the analysers over out/raw/*.html (no network). Use after fixing a parser. */
function cmdReparse() {
  const disc = load<{ at: string; interval: number; lists: ListAnalysis[]; details: DetailAnalysis[]; fetchLog: FetchLog[] }>('discover.json');
  if (!disc) { console.error('No discover.json.'); process.exit(1); }
  const readRaw = (url: string) => { const p = join(RAW, `${slug(url)}.html`); return existsSync(p) ? readFileSync(p, 'utf8') : null; };
  const lists = disc.lists.map((l) => { const h = readRaw(l.url); return h ? analyseList(l.url, l.category, h) : l; });
  const details = disc.details.map((d) => { const h = readRaw(d.url); return h ? analyseDetail(d.url, d.category, h) : d; });
  save('discover.json', { ...disc, reparsedAt: new Date().toISOString(), lists, details });
  printDiscoverSummary(lists, details);
}

const commands: Record<string, () => Promise<void> | void> = { robots: cmdRobots, discover: cmdDiscover, rate: cmdRate, hotlink: cmdHotlink, recheck: cmdRecheck, report: cmdReport, selftest: cmdSelftest, reparse: cmdReparse };
if (!commands[command]) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*$|^\/\*\*?|^\s\*\s?/gm, ''));
  process.exit(command === 'help' ? 0 : 1);
}
process.on('SIGINT', () => { save(`interrupted-${command}-${Date.now()}.json`, fetchLog); console.log('\nInterrupted; fetch log saved.'); process.exit(130); });
await commands[command]();
