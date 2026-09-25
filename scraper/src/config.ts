/**
 * Crawl plan and politeness settings (docs/03 "Scheduling and rate limits",
 * docs/12 "Crawl plan per night"). Everything the scheduler needs to build a
 * night's job queue lives here; nothing in this file does I/O.
 *
 * Slug provenance:
 *   (probe)  = seen in a saved page from tools/probe/out/raw
 *   (03)     = from the canonical district table in docs/03
 *   (infer)  = SS's usual transliteration pattern, NOT yet observed. Verify
 *              on the first live run; the scheduler skips a URL whose list
 *              page parses to 0 rows and logs `unknown_slug`.
 */
import type { SsCategory } from './types.ts';

export const BASE = 'https://www.ss.com';

export const env = {
  supabaseUrl: process.env.SUPABASE_URL ?? '',
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  mailto: process.env.SCRAPER_MAILTO ?? '',
  cacheDir: process.env.SCRAPER_CACHE_DIR ?? '.cache/html',
};

export const userAgent = (mailto = env.mailto) => `UzminiCenuBot/1.0 (+mailto:${mailto || 'unset'})`;

export const politeness = {
  intervalMs: 2500,
  jitterMs: 500, // ± → 2.0 s .. 3.0 s
  timeoutMs: 15_000,
  nightlyBudget: 3000, // hard stop
  detailBudget: 1800,
  recheckBudget: 600,
  workers: 1, // strictly serial
  /** docs/03 retry table: network / 5xx / timeout */
  retryDelaysMs: [10_000, 60_000, 300_000],
  zeroRowsRetryMs: 60_000,
  blockHours: 24,
  cacheTtlDays: 7,
  recheckAfterDays: 3,
};

export const BLOCK_WORDS = ['captcha', 'g-recaptcha', 'cf-challenge', 'access denied', 'jūs esat bloķēts', 'too many requests'];

/** Path fragments we never follow (robots.txt + docs/12). */
export const FORBIDDEN_PATH_RE = /\/(en|photo|nophoto|eur|ls|c|go|frame|inbox|w_inc)\/|_f\/|\/abuse\/|\/contacts\/|\/search\/|fDg[\w=+-]*\.html|\/msg\/(en|ru)\//;

/** Redirect targets that mean "not the desktop site we asked for". */
export const OUT_OF_FAMILY_HOSTS = ['m.ss.com'];

export interface ListJob {
  category: SsCategory;
  url: string;
  pages: number;
  /** slug provenance flag; `true` means never seen in a saved page */
  unverified?: boolean;
  /** random only: SS sub-category slug stored in attributes.subcategory */
  subcategory?: string;
}

// ─── flats: Riga districts ───────────────────────────────────────────────────

/** 20 largest Riga districts by active sell ads (03 table slugs). */
export const RIGA_TOP_DISTRICTS: string[] = [
  'centre', // (probe)
  'purvciems', // (probe)
  'plyavnieki', // (03)
  'teika', // (03)
  'imanta', // (03)
  'ziepniekkalns', // (03)
  'kengarags', // (03)
  'yugla', // (03)
  'mezhciems', // (03)
  'agenskalns', // (03)
  'zolitude', // (03)
  'ilguciems', // (03)
  'sarkandaugava', // (03)
  'chiekurkalns', // (03)
  'vecmilgravis', // (03)
  'bolderaya', // (03)
  'darzciems', // (03)
  'maskavas-priekshpilseta', // (03)
  'tornjakalns', // (03)
  'grizinkalns', // (03)
];

export const FLATS_OTHER_REGIONS: string[] = ['riga-region', 'jurmala', 'liepaja', 'daugavpils', 'jelgava', 'ogre'];

// ─── houses ──────────────────────────────────────────────────────────────────

/** Houses need `/all/` between region and deal (probe). */
export const HOUSES_REGIONS: { region: string; unverified?: boolean }[] = [
  { region: 'riga-region' }, // (probe)
  { region: 'jurmala', unverified: true }, // (infer)
];

// ─── cars ────────────────────────────────────────────────────────────────────

/** 25 most common makes on SS Latvia. URL slug → canonical display name. */
export const CAR_MAKES: Record<string, string> = {
  audi: 'Audi', // (probe)
  volkswagen: 'Volkswagen', // (probe)
  bmw: 'BMW',
  'mercedes': 'Mercedes-Benz',
  toyota: 'Toyota',
  volvo: 'Volvo',
  opel: 'Opel',
  ford: 'Ford',
  skoda: 'Škoda',
  renault: 'Renault',
  peugeot: 'Peugeot',
  honda: 'Honda',
  nissan: 'Nissan',
  mazda: 'Mazda',
  hyundai: 'Hyundai',
  kia: 'Kia',
  citroen: 'Citroën',
  lexus: 'Lexus',
  mitsubishi: 'Mitsubishi',
  subaru: 'Subaru',
  seat: 'Seat',
  fiat: 'Fiat',
  'land-rover': 'Land Rover',
  porsche: 'Porsche',
  tesla: 'Tesla',
  // not crawled, but mapped so a stray URL still canonicalises:
  vaz: 'VAZ (Lada)',
  gaz: 'GAZ',
  'alfa-romeo': 'Alfa Romeo',
  dacia: 'Dacia',
  suzuki: 'Suzuki',
  chevrolet: 'Chevrolet',
  jeep: 'Jeep',
  mini: 'Mini',
  saab: 'Saab',
  jaguar: 'Jaguar',
};
/** Only these 25 are scheduled nightly; every key above except `audi`/`volkswagen` is (infer). */
export const CAR_MAKES_CRAWLED = Object.keys(CAR_MAKES).slice(0, 25);

/** Model codes whose casing SS lower-cases in URLs; anything else is upper-cased when it is a letter+digit code. */
export const MODEL_CASE_EXCEPTIONS: Record<string, string> = {
  'e-tron': 'e-tron',
  'id-3': 'ID.3',
  'id-4': 'ID.4',
  'id-5': 'ID.5',
  'id-7': 'ID.7',
  'id-buzz': 'ID. Buzz',
  'golf-plus': 'Golf Plus',
  'golf-2': 'Golf 2',
  'golf-7': 'Golf 7',
  'passat-b8': 'Passat B8',
  allroad: 'Allroad',
  'e-class': 'E-Class',
  'c-class': 'C-Class',
  'model-3': 'Model 3',
  'model-s': 'Model S',
  'model-y': 'Model Y',
  'model-x': 'Model X',
};

/** Trim words stripped from free-text model into `trim_hint` (docs/03). */
export const TRIM_WORDS = ['s-line', 'quattro', 'amg', 'tdi', 'tfsi', 'tsi', '4matic', 'xdrive', 'avant', 'sportback', 'r-line', 'gti', 'gtd', 'm-paket', 'm paket', 'allroad'];

// ─── random ──────────────────────────────────────────────────────────────────

export interface RandomSub {
  path: string; // /lv/{cat}/{sub}/{leaf}
  subcategory: string;
  unverified?: boolean;
}

/**
 * Allowlisted leaf sub-categories (docs/03 "random category extras").
 * `/lv/home-stuff/furniture-interior/` index was saved by the probe, so all
 * furniture leaves are (probe). Electronics leaves are (infer): the probe saved
 * only the `/lv/electronics/{sub}/` index links, not their leaf pages.
 */
export const RANDOM_SUBCATEGORIES: RandomSub[] = [
  { path: '/lv/home-stuff/furniture-interior/chairs', subcategory: 'chairs' }, // (probe)
  { path: '/lv/home-stuff/furniture-interior/carpets', subcategory: 'carpets' }, // (probe)
  { path: '/lv/home-stuff/furniture-interior/sofas', subcategory: 'sofas' }, // (probe) index link; list page seen as sofas-armchairs? both kept
  { path: '/lv/home-stuff/furniture-interior/tables', subcategory: 'tables' }, // (probe)
  { path: '/lv/home-stuff/furniture-interior/lusters-sconces', subcategory: 'lamps' }, // (probe)
  { path: '/lv/home-stuff/furniture-interior/mirrors', subcategory: 'mirrors' }, // (probe)
];

/** Trees never crawled for `random` (docs/03). Checked against every URL before fetch. */
export const RANDOM_EXCLUDED_PATH_RE = /\/(work|erotika|dating|animals|weapons|medical|medicine|tobacco|alcohol|health-beauty|brokers-services|.*-services)\//;

/** Small lv+ru adult/profanity list for `random` titles (docs/03). Kept short on purpose; curation catches the rest. */
export const RANDOM_BAD_WORDS = ['sekss', 'erotik', 'intīm', 'секс', 'эрот', 'интим', 'pornogr', 'порно', 'ierocis', 'оружие', 'tabaka', 'cigaret', 'сигарет', 'alkohol', 'алкогол'];

// ─── list URLs ───────────────────────────────────────────────────────────────

export const CRAWL_PAGES: Record<SsCategory, number> = { flats: 3, houses: 5, cars: 2, random: 3, land: 3 };

export function buildListJobs(categories: SsCategory[] = ['flats', 'houses', 'cars', 'random']): ListJob[] {
  const jobs: ListJob[] = [];
  if (categories.includes('flats')) {
    for (const d of RIGA_TOP_DISTRICTS) jobs.push({ category: 'flats', url: `${BASE}/lv/real-estate/flats/riga/${d}/sell/`, pages: CRAWL_PAGES.flats });
    for (const r of FLATS_OTHER_REGIONS) jobs.push({ category: 'flats', url: `${BASE}/lv/real-estate/flats/${r}/sell/`, pages: CRAWL_PAGES.flats, unverified: true });
  }
  if (categories.includes('houses')) {
    for (const h of HOUSES_REGIONS) jobs.push({ category: 'houses', url: `${BASE}/lv/real-estate/homes-summer-residences/${h.region}/all/sell/`, pages: CRAWL_PAGES.houses, unverified: h.unverified });
  }
  if (categories.includes('cars')) {
    for (const m of CAR_MAKES_CRAWLED) jobs.push({ category: 'cars', url: `${BASE}/lv/transport/cars/${m}/sell/`, pages: CRAWL_PAGES.cars, unverified: !['audi', 'volkswagen'].includes(m) });
  }
  if (categories.includes('random')) {
    for (const s of RANDOM_SUBCATEGORIES) jobs.push({ category: 'random', url: `${BASE}${s.path}/sell/`, pages: CRAWL_PAGES.random, unverified: s.unverified, subcategory: s.subcategory });
  }
  return jobs;
}

/** `page1` is the bare URL; page N ≥ 2 is `pageN.html` (probe). */
export const pageUrl = (listUrl: string, page: number) => (page <= 1 ? listUrl : `${listUrl}page${page}.html`);
