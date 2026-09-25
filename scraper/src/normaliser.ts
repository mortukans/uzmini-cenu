/**
 * RawListing → ParsedListing (docs/03 "Normalisation rules", docs/12 "Field mapping").
 * Pure functions only. Personal data (Iela, phone, description, Kadastra
 * numurs, VIN, plate, Adrese, Darbalaiks, WWW) is dropped here, before the
 * writer ever sees it.
 */
import { CAR_MAKES, MODEL_CASE_EXCEPTIONS, TRIM_WORDS } from './config.ts';
import { districtByName, districtFromUrl } from './districts.ts';
import type { Deal, Fuel, Gearbox, ListingAttributes, ParsedListing, RawListing, Region, SsCategory, SsRawDetail } from './types.ts';

// ─── price ───────────────────────────────────────────────────────────────────

export type PriceKind = 'sell' | 'rent' | 'buy' | 'change' | 'missing' | 'not_eur' | 'unparsed';

export interface ParsedPrice {
  eur: number | null;
  kind: PriceKind;
  vatIncluded?: boolean;
}

const SEP_RE = /[\s   .,]/g;

/**
 * '68 000 €', '68,000 €', '68 000 € (1 360 €/m²)', '4 900 €*PVN iekļauts' → 68000 / 4900.
 * Decimal prices do not exist on SS sale listings; every `.`/`,` is a thousands separator.
 */
export function parsePrice(text: string | null | undefined): ParsedPrice {
  if (!text) return { eur: null, kind: 'missing' };
  const raw = text.replace(/ /g, ' ').trim();
  const t = raw.toLowerCase();
  if (!t) return { eur: null, kind: 'missing' };
  if (/€\s*\/\s*mēn|€\s*\/\s*dien|€\s*\/\s*ned|€\s*\/\s*st|mēnesī|dienā|\/mēn|в месяц|в сутки/.test(t)) return { eur: null, kind: 'rent' };
  if (/pērku|pērk\b|куплю|купл/.test(t)) return { eur: null, kind: 'buy' };
  if (/mai[nņ][ua]?\b|maiņa|обмен/.test(t)) return { eur: null, kind: 'change' };
  if (/vienojoties|vienošan|договорн|bez maksas|atdod/.test(t)) return { eur: null, kind: 'missing' };
  if (/\d\s*(ls|lvl|\$|usd|£|gbp|rub|руб)\b/.test(t) && !t.includes('€')) return { eur: null, kind: 'not_eur' };
  const m = t.match(/(\d[\d\s   .,]*)\s*(€|eur\b)/);
  if (!m) return { eur: null, kind: /\d/.test(t) ? 'unparsed' : 'missing' };
  const n = Number(m[1]!.replace(SEP_RE, ''));
  if (!Number.isFinite(n) || n <= 0) return { eur: null, kind: 'missing' };
  return { eur: n, kind: 'sell', vatIncluded: /pvn/.test(t) || undefined };
}

// ─── numeric helpers ─────────────────────────────────────────────────────────

const num = (s: string) => Number(s.replace(/ /g, '').replace(/\s/g, '').replace(',', '.'));

/** '50 m²', '50.5 m2', '50,5 kv.m', '1725 m²' → float m². 'ha' → ×10 000. */
export function parseM2(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const t = text.toLowerCase().replace(/ /g, ' ');
  const m = t.match(/(\d+(?:[.,]\d+)?)\s*(ha|m²|m2|kv\.?\s?m|кв\.?\s?м|га)?/);
  if (!m) return undefined;
  let n = num(m[1]!);
  if (m[2] === 'ha' || m[2] === 'га') n *= 10_000;
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : undefined;
}

/** '5/5', '1/9 (lifts)', 'pagr.', '0', '3' → floor/floors_total/elevator */
export function parseFloor(text: string | undefined): { floor?: number; floors_total?: number; elevator?: boolean } {
  if (!text) return {};
  const t = text.toLowerCase();
  const elevator = /lift|лифт/.test(t) ? true : undefined;
  const clean = t.replace(/\(.*?\)/g, '').trim();
  if (/^(pagr|cok|цок|подв|0)/.test(clean)) {
    const tot = clean.match(/\/\s*(\d+)/);
    return { floor: 0, floors_total: tot ? Number(tot[1]) : undefined, elevator };
  }
  const m = clean.match(/(\d+)\s*(?:\/\s*(\d+))?/);
  if (!m) return { elevator };
  return { floor: Number(m[1]), floors_total: m[2] ? Number(m[2]) : undefined, elevator };
}

export const CURRENT_YEAR = new Date().getFullYear();

/** '2007 marts', '2007 g.', '2012 novembris' → 2007; undefined if no 1950..now+1 year. */
export function parseYear(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const m = text.match(/\b(19[5-9]\d|20\d\d)\b/);
  if (!m) return undefined;
  const y = Number(m[1]);
  return y >= 1950 && y <= CURRENT_YEAR + 1 ? y : undefined;
}

/** '345 tūkst.' → 345000; '218 400' → 218400; '175 тыс.' → 175000; '-' → undefined */
export function parseKm(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const t = text.toLowerCase().replace(/ /g, ' ').trim();
  if (!t || t === '-' || t === '—') return undefined;
  const m = t.match(/(\d[\d\s.,]*)/);
  if (!m) return undefined;
  let n = Number(m[1]!.replace(/[\s.,]/g, ''));
  if (/tūkst|тыс|\bk\b/.test(t)) n *= 1000;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** '3.0 dīzelis' → {engine_l: 3, fuel: 'diesel'}; '2.0D' (list) → same; 'E' / 'Elektriskais' → electric */
export function parseEngine(text: string | undefined): { engine_l?: number; fuel?: Fuel } {
  if (!text) return {};
  const t = text.toLowerCase().replace(/ /g, ' ').trim();
  const out: { engine_l?: number; fuel?: Fuel } = {};
  const m = t.match(/(\d+(?:[.,]\d+)?)/);
  if (m) {
    const l = num(m[1]!);
    if (l > 0 && l < 12) out.engine_l = l;
  }
  if (/elektr|электр|^e$|\be\b(?!\w)/.test(t) && !/hibr|гибр/.test(t)) out.fuel = 'electric';
  else if (/hibr|гибр|hybrid/.test(t)) out.fuel = 'hybrid';
  else if (/gāz|газ|lpg|cng/.test(t)) out.fuel = 'lpg';
  else if (/dīz|diz|дизел|\dd\b|d$/.test(t)) out.fuel = 'diesel';
  else if (/benz|бенз|petrol|\db\b/.test(t)) out.fuel = 'petrol';
  else if (out.engine_l !== undefined && /^\d+(?:[.,]\d+)?$/.test(t)) out.fuel = 'petrol'; // list column '2.3' with no suffix = petrol
  if (out.fuel === 'electric') delete out.engine_l;
  return out;
}

export function parseGearbox(text: string | undefined): Gearbox | undefined {
  if (!text) return undefined;
  const t = text.toLowerCase();
  if (/autom|автомат|variator|variators|вариатор|robot|робот/.test(t)) return 'auto';
  if (/manu|mehān|механ|ручн/.test(t)) return 'manual';
  return undefined;
}

/** '04.2027' → '2027-04' */
export function parseInspection(text: string | undefined): string | undefined {
  const m = text?.match(/(\d{2})\.(\d{4})/);
  return m ? `${m[2]}-${m[1]}` : undefined;
}

/** 'dd.mm.yyyy HH:MM' Europe/Riga → ISO (UTC). */
export function parsePostedAt(text: string | undefined): string | null {
  const m = text?.match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, d, mo, y, h, mi] = m;
  const local = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)));
  // Riga offset: EET (+2) / EEST (+3), DST between last Sunday of March and last Sunday of October
  const offset = rigaOffsetHours(local);
  return new Date(local.getTime() - offset * 3600_000).toISOString();
}

function rigaOffsetHours(d: Date): number {
  const y = d.getUTCFullYear();
  const lastSunday = (month: number) => {
    const last = new Date(Date.UTC(y, month + 1, 0));
    return new Date(Date.UTC(y, month, last.getUTCDate() - last.getUTCDay(), 1));
  };
  return d >= lastSunday(2) && d < lastSunday(9) ? 3 : 2;
}

// ─── region / location ───────────────────────────────────────────────────────

const RIGA_REGION_TOWNS = ['jūrmala', 'jurmala', 'rīgas rajons', 'rīgas raj', 'riga_region', 'rīgas rajona'];

/**
 * `Vieta` / `Pilsēta` text → region. 'Rīga' → riga; 'Jūrmala' / 'Rīgas rajons' →
 * riga_region; anything else (incl. 'Valka un raj.') → latvia.
 */
export function regionFromLocation(text: string | undefined): Region | null {
  if (!text) return null;
  const t = text.toLowerCase().replace(/ /g, ' ').trim();
  if (!t) return null;
  if (/^r[īi]ga$|^рига$|^r[īi]ga\b(?! rajons| raj)/.test(t)) return 'riga';
  if (RIGA_REGION_TOWNS.some((x) => t.startsWith(x)) || /^юрмала|^рижский р/.test(t)) return 'riga_region';
  return 'latvia';
}

/** Real-estate URLs only (cars can be anywhere, docs/12 surprise #3): `/real-estate/flats/riga/` → riga. */
export function regionFromUrl(url: string): Region | null {
  const m = url.match(/\/real-estate\/[a-z-]+\/([a-z-]+)\//);
  if (!m) return null;
  if (m[1] === 'riga') return 'riga';
  if (m[1] === 'riga-region' || m[1] === 'jurmala') return 'riga_region';
  if (m[1] === 'all' || m[1] === 'new') return null;
  return 'latvia';
}

/** 'Valka un raj.' → 'Valka'; 'Talsi un raj.' → 'Talsi'; 'Rīgas rajons' → 'Rīgas rajons' */
export function townFromLocation(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const t = text.replace(/ /g, ' ').replace(/\s+un\s+raj\.?$/i, '').replace(/\s+и\s+р-н\.?$/i, '').trim();
  return t || undefined;
}

// ─── sanitiser ───────────────────────────────────────────────────────────────

const PHONE_RE = /(\+?\s?371)?[\s-]?\b\d{2}[\s-]?\d{3}[\s-]?\d{3}\b|\(\+371\)\s?[\d-]+\*{0,3}/g;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]+/g;
const HANDLE_RE = /(^|\s)@\w+/g;
const SIA_RE = /\b(SIA|AS|IK|ООО|ЗАО)\s*["'«„”“][^"'»“”]+["'»“”]/g;
/** digits (≥1) optionally grouped, followed by €/eur/ls/k/tūkst/thousand-ish markers */
const PRICE_RE = /(?<![\p{L}\d])\d[\d\s .,]*\s?(€|eur\b|euro\b|ls\b|lvl\b|k\b|tūkst\.?|tukst\.?|тыс\.?|евро\b|\$)/giu;
const PHONE_WORD_RE = /\b(tel|tālr|tālrunis|zvanīt|zvani|звонить|тел)\.?:?\s*(?=$|[,.;])/gi;
const PRICE_WORD_RE = /\b(cena|price|цена)\s*[:\-]?\s*(\d[\d\s.,]*)?\s*(€|eur\b|euro\b|евро\b)?/gi;
const STRAY_CURRENCY_RE = /(^|\s)(€|eur|euro|ls|евро)(?=\s|,|\.|$)/gi;

export function scrubTitle(text: string | undefined | null, max = 80): string | null {
  if (!text) return null;
  let t = text.replace(/ /g, ' ');
  t = t.replace(PRICE_RE, ' ').replace(PRICE_WORD_RE, ' ').replace(STRAY_CURRENCY_RE, ' ').replace(PHONE_RE, ' ').replace(EMAIL_RE, ' ').replace(HANDLE_RE, ' ').replace(SIA_RE, ' ');
  t = t.replace(/\s+/g, ' ').replace(PHONE_WORD_RE, ' ');
  t = t.replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim().replace(/^[,.;:\-–—\s]+|[,;:\-–—\s]+$/g, '');
  if (t.length > max) {
    t = t.slice(0, max);
    const cut = t.lastIndexOf(' ');
    if (cut > max / 2) t = t.slice(0, cut);
    t = t.replace(/[,;:\-–—\s]+$/g, '');
  }
  return t || null;
}

/** True if a scrubbed hint still leaks a price-like token (docs/03 `title_leak`). */
export const titleLeaks = (hint: string | null) => !!hint && /\d{3,}[\d\s]*\s?(€|eur|ls|k\b|tūkst)/i.test(hint);

// ─── cars ────────────────────────────────────────────────────────────────────

export function canonicalMake(slug: string | undefined): string | undefined {
  if (!slug) return undefined;
  const s = slug.toLowerCase();
  if (s === 'others' || s === 'other' || s === 'new' || s === 'exchange') return undefined;
  return CAR_MAKES[s] ?? s.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function canonicalModel(slug: string | undefined): string | undefined {
  if (!slug) return undefined;
  const s = slug.toLowerCase();
  if (MODEL_CASE_EXCEPTIONS[s]) return MODEL_CASE_EXCEPTIONS[s];
  if (/^[a-z]{1,2}-?\d{1,4}[a-z]?$/.test(s)) return s.toUpperCase().replace('-', ''); // a4 → A4, q7 → Q7, x5 → X5, c-hr → CHR? keep simple
  if (/^\d+[a-z]*$/.test(s)) return s.toUpperCase(); // 100, 320d
  return s.split('-').map((w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
}

/** `/msg/lv/transport/cars/{make}/{model}/{id}.html` → segments */
export function carUrlSegments(url: string): { make?: string; model?: string } {
  const m = url.match(/\/transport\/cars\/([a-z0-9-]+)(?:\/([a-z0-9-]+))?\/[a-z]{4,7}\.html$/i) ?? url.match(/\/transport\/cars\/([a-z0-9-]+)\/([a-z0-9-]+)\//i);
  if (!m) return {};
  return { make: m[1], model: m[2] && !/^(sell|buy|change|rent|other)$/.test(m[2]) ? m[2] : undefined };
}

/** 'Volkswagen Touran' with make 'Volkswagen' → model 'Touran'; extracts trims. */
export function splitMakeModel(marka: string | undefined, make: string | undefined): { model?: string; trim_hint?: string } {
  if (!marka) return {};
  let rest = marka.trim();
  if (make) {
    const re = new RegExp(`^${make.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\s+`, 'i');
    rest = rest.replace(re, '');
    // "Mercedes-Benz" vs "Mercedes"
    rest = rest.replace(/^mercedes(-benz)?\s+/i, '').replace(/^vw\s+/i, '');
  }
  const words = rest.split(/\s+/).filter(Boolean);
  const trims = words.filter((w) => TRIM_WORDS.includes(w.toLowerCase()));
  const model = words.filter((w) => !TRIM_WORDS.includes(w.toLowerCase())).join(' ');
  return { model: model || undefined, trim_hint: trims.length ? trims.join(' ') : undefined };
}

// ─── main ────────────────────────────────────────────────────────────────────

const NEVER_STORE = new Set(['Iela', 'Kadastra numurs', 'VIN kods', 'Valsts numura zīme', 'Adrese', 'Darbalaiks', 'WWW', 'Tālrunis', 'E-mail', 'Vietu skaits']);

export function dealFromBreadcrumb(crumbs: string[]): Deal | undefined {
  const last = crumbs.at(-1)?.toLowerCase();
  if (!last) return undefined;
  if (last.startsWith('pārdod') || last === 'продаю' || last === 'продают') return 'sell';
  if (last.startsWith('pērk') || last.startsWith('куп')) return 'buy';
  if (last.startsWith('izīrē') || last.startsWith('īrē') || last.startsWith('iznomā') || last.startsWith('сда') || last.startsWith('сним')) return 'rent';
  if (last.startsWith('maina') || last.startsWith('мен')) return 'change';
  if (last.startsWith('dažādi') || last.startsWith('разн')) return 'other';
  return undefined;
}

export function dealFromUrl(url: string): Deal | undefined {
  const m = url.match(/\/(sell|buy|hand_over|rent|change|exchange|other)\/(page\d+\.html)?$/);
  if (!m) return undefined;
  switch (m[1]) {
    case 'sell':
      return 'sell';
    case 'buy':
      return 'buy';
    case 'hand_over':
    case 'rent':
      return 'rent';
    case 'change':
    case 'exchange':
      return 'change';
    default:
      return 'other';
  }
}

export interface NormaliseOptions {
  keepRaw?: boolean; // attributes._raw for 30 d re-normalisation (default true)
  now?: Date;
}

export function normalise(raw: RawListing, opts: NormaliseOptions = {}): ParsedListing {
  const { category, row, detail, listUrl } = raw;
  const a = detail?.attrs ?? {};
  const attrs: ListingAttributes = {};

  // price: detail first, list cell (last cell) as fallback
  const listPriceText = row.cells.at(-1) ?? '';
  const price = parsePrice(detail?.priceText || listPriceText);
  const listPrice = parsePrice(listPriceText);

  // deal: URL (we only crawl /sell/) → breadcrumb → price text
  const urlDeal = dealFromUrl(listUrl) ?? 'sell';
  const crumbDeal = detail ? dealFromBreadcrumb(detail.breadcrumb) : undefined;
  let deal: Deal = crumbDeal ?? urlDeal;
  if (price.kind === 'rent' || listPrice.kind === 'rent') deal = 'rent';
  else if (price.kind === 'buy' || listPrice.kind === 'buy') deal = 'buy';
  else if (price.kind === 'change' || listPrice.kind === 'change') deal = 'change';

  // region / location
  const vieta = detail?.locationText ?? a['Vieta'] ?? row.regionHint;
  const pilseta = a['Pilsēta'] ?? a['Pilsēta/pagasts'];
  let region: Region | null = regionFromLocation(vieta) ?? regionFromLocation(pilseta) ?? regionFromLocation(a['Pilsēta, rajons']) ?? (category === 'flats' || category === 'houses' || category === 'land' ? regionFromUrl(row.sourceUrl) : null);
  let location: string | null = null;

  switch (category) {
    case 'flats':
    case 'houses':
    case 'land':
      normaliseRealEstate(category, raw, a, attrs);
      break;
    case 'cars':
      normaliseCar(raw, a, attrs);
      break;
    case 'random':
      normaliseRandom(raw, a, attrs);
      break;
  }

  // location
  if (region === 'riga') {
    const d = (a['Rajons'] && districtByName(a['Rajons'])) || districtFromUrl(row.sourceUrl);
    if (d) {
      attrs.district = d.slug;
      location = d.slug === 'other' ? 'Rīga' : d.lv;
    } else location = 'Rīga';
    if (category === 'cars' || category === 'random') location = 'Rīga';
  } else {
    const town = pilseta ?? (a['Pilsēta, rajons'] && category === 'houses' ? townFromLocation(a['Ciems'] ?? a['Pilsēta, rajons']) : undefined) ?? townFromLocation(vieta);
    if (town) {
      attrs.town = scrubTitle(town, 60) ?? undefined;
      location = attrs.town ?? null;
    }
    if (!region && (town || vieta)) region = 'latvia';
  }
  if (region === 'riga_region' && !attrs.town && vieta) attrs.town = townFromLocation(vieta);
  if (region === 'riga_region' && !location) location = attrs.town ?? 'Rīgas rajons';

  // dealer flag
  if (a['Uzņēmums']) attrs.dealer = true;
  if (row.promoted) attrs.promoted = true;

  // raw copy (minus PII)
  if (opts.keepRaw !== false && detail) {
    const _raw: Record<string, string> = {};
    for (const [k, v] of Object.entries(a)) if (!NEVER_STORE.has(k)) _raw[k] = v;
    _raw['Cena'] = detail.priceText;
    if (Object.keys(_raw).length) attrs._raw = _raw;
  }

  const title_hint = scrubTitle(row.titleSnippet);

  return {
    source: 'ss',
    source_url: row.sourceUrl,
    category,
    deal,
    price_eur: price.eur,
    region,
    location,
    attributes: attrs,
    title_hint,
    photo_urls: (detail?.photoUrls ?? (row.thumbUrl ? [row.thumbUrl.replace(/\.th2\.jpg$/, '.800.jpg')] : [])).slice(0, 8),
    posted_at: parsePostedAt(detail?.postedAtText),
  };
}

function normaliseRealEstate(category: SsCategory, raw: RawListing, a: Record<string, string>, attrs: ListingAttributes) {
  const { row, detail } = raw;
  const rooms = a['Istabas'] ?? (category === 'flats' ? row.cells[1] : undefined);
  if (rooms && /^\d+$/.test(rooms.trim())) attrs.rooms = Number(rooms);
  const m2 = parseM2(a['Platība'] ?? (category === 'flats' ? row.cells[2] : row.cells[1]));
  if (m2) attrs.m2 = m2;
  const land = parseM2(a['Zemes platība']);
  if (land) attrs.land_m2 = land;
  if (category === 'land' && !attrs.m2 && land) attrs.m2 = land;
  const floorText = a['Stāvs'] ?? (category === 'flats' ? row.cells[3] : undefined);
  if (floorText) {
    const f = parseFloor(floorText);
    if (f.floor !== undefined) attrs.floor = f.floor;
    if (f.floors_total !== undefined) attrs.floors_total = f.floors_total;
    if (f.elevator) attrs.elevator = true;
  }
  const floors = a['Stāvi'] ?? a['Stāvu skaits'];
  if (floors && /^\d+/.test(floors)) attrs.floors_total = Number(floors.match(/^\d+/)![0]);
  const series = a['Sērija'] ?? (category === 'flats' ? row.cells[4] : undefined);
  if (series && series !== '-') attrs.series = series;
  if (a['Mājas tips']) attrs.house_type = a['Mājas tips'];
  if (a['Ērtības']) attrs.amenities = a['Ērtības'].split(/\s*,\s*/).filter(Boolean);
  void detail;
}

function normaliseCar(raw: RawListing, a: Record<string, string>, attrs: ListingAttributes) {
  const { row } = raw;
  const seg = carUrlSegments(row.sourceUrl);
  const make = canonicalMake(seg.make);
  if (make) attrs.make = make;
  const fromMarka = splitMakeModel(a['Marka'], make ?? seg.make);
  const model = seg.model ? canonicalModel(seg.model) : (a['Modelis'] ?? fromMarka.model ?? row.cells[0]);
  if (model) attrs.model = model;
  if (fromMarka.trim_hint) attrs.trim_hint = fromMarka.trim_hint;
  const year = parseYear(a['Izlaiduma gads'] ?? row.cells[1]);
  if (year) attrs.year = year;
  const eng = parseEngine(a['Motors'] ?? a['Dzinēja tips'] ?? row.cells[2]);
  if (eng.engine_l !== undefined) attrs.engine_l = eng.engine_l;
  if (eng.fuel) attrs.fuel = eng.fuel;
  const gb = parseGearbox(a['Ātrumkārba']);
  if (gb) attrs.gearbox = gb;
  const km = parseKm(a['Nobraukums, km'] ?? a['Nobraukums'] ?? row.cells[3]);
  if (km !== undefined) attrs.km = km;
  if (a['Krāsa']) attrs.color = a['Krāsa'];
  if (a['Virsbūves tips']) attrs.body = a['Virsbūves tips'];
  const insp = parseInspection(a['Tehniskā apskate']);
  if (insp) attrs.inspection_until = insp;
}

function normaliseRandom(raw: RawListing, a: Record<string, string>, attrs: ListingAttributes) {
  const { row, listUrl } = raw;
  const sub = listUrl.match(/\/lv\/[a-z-]+\/[a-z-]+\/([a-z-]+)\/(sell\/)?/)?.[1] ?? row.sourceUrl.match(/\/msg\/lv\/[a-z-]+\/[a-z-]+\/([a-z-]+)\//)?.[1];
  if (sub) attrs.subcategory = sub;
  const manufacturer = a['Ražotājs'] ?? row.cells[0];
  if (manufacturer && manufacturer !== '-') attrs.manufacturer = scrubTitle(manufacturer, 40) ?? undefined;
  const cond = a['Stāvoklis'] ?? row.cells[1];
  if (cond && /^(jaun|lietot|новы|б\/у|jauns|jauna)/i.test(cond)) attrs.condition = /^jaun|нов/i.test(cond) ? 'new' : 'used';
}

/** Convenience for --dry-run and tests: build a RawListing from a detail page alone. */
export function rawFromDetail(category: SsCategory, listUrl: string, detail: SsRawDetail, titleSnippet = ''): RawListing {
  return { category, listUrl, row: { sourceUrl: detail.sourceUrl, titleSnippet, cells: [], promoted: false }, detail };
}
