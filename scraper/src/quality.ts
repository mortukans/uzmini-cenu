/**
 * Quality gate (docs/03 "Quality filters"). Pure. Returns the first reject
 * reason found, or the listing (possibly with `title_hint` dropped on a leak).
 *
 * Thresholds follow the scraper task brief (wider than the first draft in
 * docs/03 so the pool fills; tighten via `THRESHOLDS` once volumes are known).
 */
import { RANDOM_BAD_WORDS, RANDOM_EXCLUDED_PATH_RE } from './config.ts';
import { titleLeaks } from './normaliser.ts';
import type { ParsedListing, QualityResult, RejectCode, SsCategory } from './types.ts';

export interface Threshold {
  min: number;
  max: number;
  photos: number;
  required: (keyof ParsedListing['attributes'] | 'title_hint')[][]; // each inner array = alternatives (any one satisfies)
}

export const THRESHOLDS: Record<SsCategory, Threshold> = {
  flats: { min: 5_000, max: 2_000_000, photos: 2, required: [['rooms'], ['m2'], ['district', 'town'], ['floor']] },
  houses: { min: 10_000, max: 3_000_000, photos: 2, required: [['m2'], ['town']] },
  land: { min: 1_000, max: 1_000_000, photos: 1, required: [['m2', 'land_m2'], ['town']] },
  cars: { min: 300, max: 200_000, photos: 2, required: [['make'], ['model'], ['year'], ['engine_l', 'fuel']] },
  random: { min: 1, max: 20_000, photos: 1, required: [['title_hint'], ['subcategory']] },
};

export const SANITY = {
  flats: { m2: [12, 400], rooms: [1, 9], ppm2: [300, 8000] },
  houses: { m2: [30, 1500] },
  cars: { km: [0, 1_000_000] },
} as const;

const PII_RE = /(\+?371[\s-]?)?\b[2-9]\d[\s-]?\d{3}[\s-]?\d{3}\b|[\w.+-]+@[\w-]+\.[a-z]{2,}/i;

export function checkQuality(l: ParsedListing, now = new Date()): QualityResult {
  const t = THRESHOLDS[l.category];
  const a = l.attributes;

  // deal must be sell
  if (l.deal === 'rent') return reject('deal_rent');
  if (l.deal === 'buy') return reject('deal_buy');
  if (l.deal === 'change') return reject('deal_change');
  if (l.deal === 'other') return reject('deal_other');

  // price
  if (l.price_eur === null || l.price_eur <= 0) return reject('price_missing');
  if (l.price_eur < t.min) return reject('price_low', String(l.price_eur));
  if (l.price_eur > t.max) return reject('price_high', String(l.price_eur));

  // category extras
  if (l.category === 'cars') {
    if (!a.make) return reject('unknown_make');
    if (!a.year) return reject('no_year');
    if (a.year > now.getFullYear() + 1) return reject('no_year', String(a.year));
    if (a.km !== undefined && (a.km < SANITY.cars.km[0] || a.km > SANITY.cars.km[1])) return reject('km_outlier', String(a.km));
  }
  if (l.category === 'flats') {
    if (a.m2 !== undefined && (a.m2 < SANITY.flats.m2[0] || a.m2 > SANITY.flats.m2[1])) return reject('m2_outlier', String(a.m2));
    if (a.rooms !== undefined && (a.rooms < SANITY.flats.rooms[0] || a.rooms > SANITY.flats.rooms[1])) return reject('rooms_outlier', String(a.rooms));
    if (a.m2) {
      const ppm2 = l.price_eur / a.m2;
      if (ppm2 < SANITY.flats.ppm2[0] || ppm2 > SANITY.flats.ppm2[1]) return reject('ppm2_outlier', ppm2.toFixed(0));
    }
  }
  if (l.category === 'houses' && a.m2 !== undefined && (a.m2 < SANITY.houses.m2[0] || a.m2 > SANITY.houses.m2[1])) return reject('m2_outlier', String(a.m2));
  if (l.category === 'random') {
    if (RANDOM_EXCLUDED_PATH_RE.test(l.source_url)) return reject('random_excluded', 'path');
    const hay = `${l.title_hint ?? ''} ${a.subcategory ?? ''}`.toLowerCase();
    const bad = RANDOM_BAD_WORDS.find((w) => hay.includes(w));
    if (bad) return reject('random_excluded', bad);
  }

  // required attributes
  for (const alternatives of t.required) {
    const ok = alternatives.some((k) => (k === 'title_hint' ? !!l.title_hint : a[k] !== undefined && a[k] !== null && a[k] !== ''));
    if (!ok) return reject('missing_attr', alternatives.join('|'));
  }

  // photos
  if (l.photo_urls.length < t.photos) return reject('few_photos', String(l.photo_urls.length));

  // leak checks: title leak drops the hint, not the listing; PII in location/hint drops the field
  let listing = l;
  if (titleLeaks(l.title_hint)) listing = { ...listing, title_hint: null };
  if (listing.title_hint && PII_RE.test(listing.title_hint)) listing = { ...listing, title_hint: null };
  if (listing.location && PII_RE.test(listing.location)) return reject('pii_leak', 'location');
  for (const key of ['town', 'manufacturer', 'model', 'series'] as const) {
    const v = listing.attributes[key];
    if (typeof v === 'string' && PII_RE.test(v)) return reject('pii_leak', key);
  }
  if (listing.category === 'random' && !listing.title_hint) return reject('missing_attr', 'title_hint');

  return { ok: true, listing };
}

const reject = (code: RejectCode, detail?: string): QualityResult => ({ ok: false, reject: code, detail });

/** Cheap list-stage pre-filter so rent/buy rows never cost a detail fetch (docs/03 "Deal type"). */
export function listStageReject(priceKind: string, listUrl: string): RejectCode | null {
  if (priceKind === 'rent' || /\/(hand_over|rent)\//.test(listUrl)) return 'deal_rent';
  if (priceKind === 'buy' || /\/buy\//.test(listUrl)) return 'deal_buy';
  if (priceKind === 'change' || /\/(change|exchange)\//.test(listUrl)) return 'deal_change';
  if (/\/other\/$/.test(listUrl)) return 'deal_other';
  if (priceKind === 'missing') return 'price_missing';
  if (priceKind === 'not_eur') return 'price_not_eur';
  return null;
}
