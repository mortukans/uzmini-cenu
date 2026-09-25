/**
 * Duplicate detection (docs/03 "Duplicate detection"), 3 tiers:
 *   1. exact source_url                     → handled by writer upsert; `dup_url` only if a *different* row has the URL
 *   2. photo fingerprint                    → cheap: the numeric photo id of the first .800.jpg (`77430610`) is unique per
 *                                             uploaded file on i.ss.com, so two ads sharing it are the same upload.
 *                                             TODO(pHash): replace/augment `photoFingerprint` with a 64-bit DCT pHash of the
 *                                             downloaded first photo and compare Hamming ≤ 8 (needs an image lib such as
 *                                             `sharp` + a tiny DCT; stored in listings.photo_hash, banded jsonb for prefilter).
 *   3. attribute fingerprint + price band   → per category, see `attrFingerprint`
 *
 * Pure: the caller supplies the candidate set (active rows of the same category).
 */
import type { ParsedListing, SsCategory } from './types.ts';

export interface ExistingRow {
  id: number;
  source_url: string;
  category: SsCategory;
  price_eur: number;
  photo_hash: string | null;
  photo_urls: string[];
  attributes: ParsedListing['attributes'];
  title_hint: string | null;
}

export type DedupeResult = { dup: false } | { dup: true; code: 'dup_url' | 'dup_photo' | 'dup_attrs'; of: number };

/** `https://i.ss.com/gallery/8/1549/387154/flats-riga-purvciems-77430610.800.jpg` → `ssid:77430610` */
export function photoFingerprint(photoUrls: string[]): string | null {
  const first = photoUrls[0];
  if (!first) return null;
  const m = first.match(/(\d{6,})\.(800|t|th2)\.jpg$/);
  return m ? `ssid:${m[1]}` : null;
}

export function attrFingerprint(l: Pick<ParsedListing, 'category' | 'attributes' | 'title_hint' | 'location'>): string | null {
  const a = l.attributes;
  switch (l.category) {
    case 'flats':
      if (a.rooms === undefined || a.m2 === undefined) return null;
      return ['flats', a.district ?? a.town ?? l.location ?? '', a.rooms, Math.round(a.m2), a.floor ?? '', a.floors_total ?? ''].join('|');
    case 'houses':
      if (a.m2 === undefined) return null;
      return ['houses', a.town ?? l.location ?? '', Math.round(a.m2 / 10), a.land_m2 !== undefined ? Math.round(a.land_m2 / 100) : ''].join('|');
    case 'land':
      if (a.m2 === undefined && a.land_m2 === undefined) return null;
      return ['land', a.town ?? l.location ?? '', Math.round((a.m2 ?? a.land_m2!) / 100)].join('|');
    case 'cars':
      if (!a.make || !a.model || !a.year) return null;
      return ['cars', a.make, a.model.toLowerCase(), a.year, a.fuel ?? '', a.km !== undefined ? Math.round(a.km / 5000) : ''].join('|');
    case 'random':
      return l.title_hint ? ['random', normaliseTitle(l.title_hint)].join('|') : null;
  }
}

const normaliseTitle = (t: string) =>
  t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zа-я0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Trigram Jaccard similarity for `random` titles. */
export function trigramSimilarity(a: string, b: string): number {
  const grams = (s: string) => {
    const p = `  ${normaliseTitle(s)} `;
    const set = new Set<string>();
    for (let i = 0; i < p.length - 2; i++) set.add(p.slice(i, i + 3));
    return set;
  };
  const ga = grams(a);
  const gb = grams(b);
  if (!ga.size || !gb.size) return 0;
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter++;
  return inter / (ga.size + gb.size - inter);
}

const PRICE_TOLERANCE: Record<SsCategory, number> = { flats: 0.03, houses: 0.03, land: 0.03, cars: 0.02, random: 0 };

export function findDuplicate(l: ParsedListing, candidates: ExistingRow[]): DedupeResult {
  const same = candidates.filter((c) => c.category === l.category);
  const byUrl = same.find((c) => c.source_url === l.source_url);
  const others = same.filter((c) => c.source_url !== l.source_url);
  void byUrl; // same URL = update path (writer upsert), never a duplicate

  const fp = photoFingerprint(l.photo_urls);
  if (fp) {
    const hit = others.find((c) => c.photo_hash === fp || photoFingerprint(c.photo_urls) === fp);
    if (hit) return { dup: true, code: 'dup_photo', of: hit.id };
  }

  if (l.price_eur === null) return { dup: false };
  const tol = PRICE_TOLERANCE[l.category];
  const priceClose = (p: number) => (tol === 0 ? p === l.price_eur : Math.abs(p - l.price_eur!) / l.price_eur! <= tol);

  if (l.category === 'random') {
    const hit = others.find((c) => c.title_hint && l.title_hint && priceClose(c.price_eur) && trigramSimilarity(c.title_hint, l.title_hint) > 0.8);
    if (hit) return { dup: true, code: 'dup_attrs', of: hit.id };
    return { dup: false };
  }

  const mine = attrFingerprint(l);
  if (!mine) return { dup: false };
  const hit = others.find((c) => priceClose(c.price_eur) && attrFingerprint({ category: c.category, attributes: c.attributes, title_hint: c.title_hint, location: null }) === mine);
  return hit ? { dup: true, code: 'dup_attrs', of: hit.id } : { dup: false };
}
