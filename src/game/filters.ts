/**
 * Listing filters for free play / streak (period, sort, car make/model):
 * normalisation, the sessionId codec segment and the human-readable summary
 * shown on the home tiles. Pure — no I/O, no React.
 */
import { DEFAULT_FILTERS, type CategoryFilter, type ListingFilters, type ListingPeriod, type ListingSort } from '../api/types';
import { LISTING_PERIODS, LISTING_SORTS } from '../api/types';

/** Minimal translate signature so this module does not depend on react-i18next. */
export type Translate = (key: string, opts?: Record<string, unknown>) => string;

// ─── base64url (UTF-8 safe) ──────────────────────────────────────────────────
// Hermes has btoa/atob, but they are Latin-1 only ("Škoda" would throw) and
// base64url needs the URL-safe alphabet anyway, so a tiny self-contained codec.

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function utf8Encode(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let cp = s.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < s.length) {
      const lo = s.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) { cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00); i++; }
    }
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  return out;
}

function utf8Decode(bytes: number[]): string {
  let s = '';
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i++];
    let cp: number;
    if (b < 0x80) cp = b;
    else if ((b & 0xe0) === 0xc0) cp = ((b & 0x1f) << 6) | (bytes[i++] & 0x3f);
    else if ((b & 0xf0) === 0xe0) cp = ((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
    else cp = ((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
    if (Number.isNaN(cp)) throw new Error('bad utf8');
    s += String.fromCodePoint(cp);
  }
  return s;
}

export function base64urlEncode(s: string): string {
  const bytes = utf8Encode(s);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
    const n = (b0 << 16) | ((b1 ?? 0) << 8) | (b2 ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += b1 === undefined ? '' : B64[(n >> 6) & 63];
    out += b2 === undefined ? '' : B64[n & 63];
  }
  return out;
}

export function base64urlDecode(s: string): string {
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) throw new Error('bad base64url');
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i += 4) {
    const c = [0, 1, 2, 3].map((k) => (i + k < s.length ? B64.indexOf(s[i + k]) : -1));
    const n = (c[0] << 18) | (c[1] << 12) | ((c[2] < 0 ? 0 : c[2]) << 6) | (c[3] < 0 ? 0 : c[3]);
    bytes.push((n >> 16) & 255);
    if (c[2] >= 0) bytes.push((n >> 8) & 255);
    if (c[3] >= 0) bytes.push(n & 255);
  }
  return utf8Decode(bytes);
}

// ─── normalisation ───────────────────────────────────────────────────────────

const isPeriod = (v: unknown): v is ListingPeriod => (LISTING_PERIODS as string[]).includes(v as string);
const isSort = (v: unknown): v is ListingSort => (LISTING_SORTS as string[]).includes(v as string);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/**
 * Coerce anything (stored prefs, a decoded sessionId segment) into a valid
 * ListingFilters. Unknown values fall back to the defaults; a model without a
 * make is dropped; make/model are stripped for non-car categories when given.
 */
export function normalizeFilters(input: Partial<ListingFilters> | null | undefined, category?: CategoryFilter): ListingFilters {
  const period = isPeriod(input?.period) ? input!.period : DEFAULT_FILTERS.period;
  const sort = isSort(input?.sort) ? input!.sort : DEFAULT_FILTERS.sort;
  const out: ListingFilters = { period, sort };
  const carsOk = category === undefined || category === 'cars';
  const make = carsOk ? str(input?.make) : undefined;
  const model = make ? str(input?.model) : undefined;
  if (make) out.make = make;
  if (model) out.model = model;
  return out;
}

export const isDefaultFilters = (f: ListingFilters): boolean =>
  f.period === DEFAULT_FILTERS.period && f.sort === DEFAULT_FILTERS.sort && !f.make && !f.model;

/** Only the fields that differ from DEFAULT_FILTERS (what the sessionId carries). */
export function nonDefaultFilters(f: ListingFilters): Partial<ListingFilters> {
  const out: Partial<ListingFilters> = {};
  if (f.period !== DEFAULT_FILTERS.period) out.period = f.period;
  if (f.sort !== DEFAULT_FILTERS.sort) out.sort = f.sort;
  if (f.make) out.make = f.make;
  if (f.make && f.model) out.model = f.model;
  return out;
}

// ─── sessionId segment ───────────────────────────────────────────────────────

/** base64url(JSON of the non-default fields), or '' when everything is default. */
export function encodeFiltersSegment(f: ListingFilters | undefined): string {
  if (!f) return '';
  const nd = nonDefaultFilters(f);
  return Object.keys(nd).length ? base64urlEncode(JSON.stringify(nd)) : '';
}

/** Inverse of encodeFiltersSegment; DEFAULT_FILTERS for '' / undefined / garbage. */
export function decodeFiltersSegment(seg: string | undefined, category?: CategoryFilter): ListingFilters {
  if (!seg) return { ...DEFAULT_FILTERS };
  try {
    const parsed: unknown = JSON.parse(base64urlDecode(seg));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...DEFAULT_FILTERS };
    return normalizeFilters(parsed as Partial<ListingFilters>, category);
  } catch {
    return { ...DEFAULT_FILTERS };
  }
}

// ─── display ─────────────────────────────────────────────────────────────────

/**
 * Non-default parts of the filters as short labels, in display order:
 * period, make + model, sort. E.g. ["7 d", "BMW X5", "Newest"].
 */
export function describeFilters(f: ListingFilters, t: Translate): string[] {
  const parts: string[] = [];
  if (f.period !== DEFAULT_FILTERS.period) parts.push(t(`filters.period.${f.period}`));
  if (f.make) parts.push(f.model ? `${f.make} ${f.model}` : f.make);
  if (f.sort !== DEFAULT_FILTERS.sort) parts.push(t(`filters.sort.${f.sort}`));
  return parts;
}

/** Keep the home tile subtitle informative: "Cars · Riga · 7 d · BMW X5". */
export function describeSelection(category: CategoryFilter, region: string | null, f: ListingFilters, t: Translate): string {
  const parts = [t(`category.${category}`)];
  if (region) parts.push(t(`region.${region}`));
  return [...parts, ...describeFilters(f, t)].join(' · ');
}
