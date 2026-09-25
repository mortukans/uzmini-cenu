import { describe, expect, it } from 'vitest';
import { attrFingerprint, findDuplicate, photoFingerprint, trigramSimilarity, type ExistingRow } from '../src/deduper.ts';
import { normalise, rawFromDetail } from '../src/normaliser.ts';
import { parseDetail } from '../src/parser/ss.ts';
import { checkQuality, listStageReject } from '../src/quality.ts';
import type { ParsedListing } from '../src/types.ts';
import { toRow } from '../src/writer.ts';
import { URLS, fixture } from './helpers.ts';

const flat = (): ParsedListing =>
  normalise(rawFromDetail('flats', URLS.flatsList, parseDetail(fixture('flats/detail-hxnxd.html'), URLS.flatHxnxd), 'Pārdodam 2-istabu dzīvokli Purvciemā'));
const car = (): ParsedListing =>
  normalise(rawFromDetail('cars', 'https://www.ss.com/lv/transport/cars/volkswagen/sell/', parseDetail(fixture('cars/detail-touran-cdegbp.html'), URLS.carTouran), 'VW Touran 1.6 TDI'));
const house = (): ParsedListing =>
  normalise(rawFromDetail('houses', URLS.housesList, parseDetail(fixture('houses/detail-sigulda-dclid.html'), URLS.houseSigulda), 'Māja Siguldā'));
const chair = (): ParsedListing =>
  normalise(rawFromDetail('random', URLS.randomList, parseDetail(fixture('random/detail-chairs-bhmxgd.html'), URLS.chair), 'Krēsli 2 gb. no masīvkoka'));
const carpet = (): ParsedListing =>
  normalise(rawFromDetail('random', 'https://www.ss.com/lv/home-stuff/furniture-interior/carpets/sell/', parseDetail(fixture('random/detail-carpets-bdmmon.html'), URLS.carpet), 'Paklājs 300x400'));

const rejectOf = (l: ParsedListing) => {
  const q = checkQuality(l);
  return q.ok ? 'ok' : q.reject;
};

describe('checkQuality accepts real fixtures', () => {
  it.each([
    ['flat', flat],
    ['car', car],
    ['house', house],
    ['chair', chair],
    ['carpet', carpet],
  ])('%s', (_, mk) => expect(rejectOf(mk())).toBe('ok'));
});

describe('checkQuality reject codes', () => {
  it('deal_*', () => {
    expect(rejectOf({ ...flat(), deal: 'rent' })).toBe('deal_rent');
    expect(rejectOf({ ...flat(), deal: 'buy' })).toBe('deal_buy');
    expect(rejectOf({ ...flat(), deal: 'change' })).toBe('deal_change');
    expect(rejectOf({ ...flat(), deal: 'other' })).toBe('deal_other');
  });
  it('price thresholds per category', () => {
    expect(rejectOf({ ...flat(), price_eur: null })).toBe('price_missing');
    expect(rejectOf({ ...flat(), price_eur: 4999 })).toBe('price_low');
    expect(rejectOf({ ...flat(), price_eur: 2_000_001 })).toBe('price_high');
    expect(rejectOf({ ...house(), price_eur: 9_999 })).toBe('price_low');
    expect(rejectOf({ ...house(), price_eur: 3_000_001 })).toBe('price_high');
    expect(rejectOf({ ...car(), price_eur: 299 })).toBe('price_low');
    expect(rejectOf({ ...car(), price_eur: 200_001 })).toBe('price_high');
    expect(rejectOf({ ...chair(), price_eur: 20_001 })).toBe('price_high');
    expect(rejectOf({ ...chair(), price_eur: 1 })).toBe('ok');
  });
  it('flats sanity: ppm2 / m2 / rooms outliers', () => {
    const f = flat();
    expect(rejectOf({ ...f, price_eur: 10_000 })).toBe('ppm2_outlier'); // 200 €/m²
    expect(rejectOf({ ...f, attributes: { ...f.attributes, m2: 10 } })).toBe('m2_outlier');
    expect(rejectOf({ ...f, attributes: { ...f.attributes, rooms: 12 } })).toBe('rooms_outlier');
  });
  it('missing_attr per category', () => {
    const f = flat();
    expect(rejectOf({ ...f, attributes: { ...f.attributes, rooms: undefined } })).toBe('missing_attr');
    expect(rejectOf({ ...f, attributes: { ...f.attributes, floor: undefined } })).toBe('missing_attr');
    expect(rejectOf({ ...f, attributes: { ...f.attributes, district: undefined, town: undefined } })).toBe('missing_attr');
    const h = house();
    expect(rejectOf({ ...h, attributes: { ...h.attributes, town: undefined } })).toBe('missing_attr');
    const c = car();
    expect(rejectOf({ ...c, attributes: { ...c.attributes, make: undefined } })).toBe('unknown_make');
    expect(rejectOf({ ...c, attributes: { ...c.attributes, year: undefined } })).toBe('no_year');
    expect(rejectOf({ ...c, attributes: { ...c.attributes, engine_l: undefined, fuel: undefined } })).toBe('missing_attr');
    expect(rejectOf({ ...c, attributes: { ...c.attributes, km: 2_000_000 } })).toBe('km_outlier');
    expect(rejectOf({ ...chair(), title_hint: null })).toBe('missing_attr');
  });
  it('few_photos: 2 for flats/houses/cars, 1 for random', () => {
    expect(rejectOf({ ...flat(), photo_urls: flat().photo_urls.slice(0, 1) })).toBe('few_photos');
    expect(rejectOf({ ...car(), photo_urls: [] })).toBe('few_photos');
    expect(rejectOf({ ...chair(), photo_urls: chair().photo_urls.slice(0, 1) })).toBe('ok');
    expect(rejectOf({ ...chair(), photo_urls: [] })).toBe('few_photos');
  });
  it('random_excluded by path and by word', () => {
    expect(rejectOf({ ...chair(), source_url: 'https://www.ss.com/msg/lv/work/are-required/abcde.html' })).toBe('random_excluded');
    expect(rejectOf({ ...chair(), title_hint: 'Erotika DVD' })).toBe('random_excluded');
  });
  it('title leak drops the hint, not the listing; PII drops hint', () => {
    const q = checkQuality({ ...flat(), title_hint: 'dzīvoklis 68000 €' });
    expect(q.ok && q.listing.title_hint).toBeNull();
    const q2 = checkQuality({ ...flat(), title_hint: 'zvanīt 26123456' });
    expect(q2.ok && q2.listing.title_hint).toBeNull();
    expect(rejectOf({ ...flat(), location: 'Rīga 26123456' })).toBe('pii_leak');
  });
  it('listStageReject', () => {
    expect(listStageReject('rent', URLS.flatsList)).toBe('deal_rent');
    expect(listStageReject('sell', 'https://www.ss.com/lv/real-estate/flats/riga/centre/buy/')).toBe('deal_buy');
    expect(listStageReject('missing', URLS.flatsList)).toBe('price_missing');
    expect(listStageReject('sell', URLS.flatsList)).toBeNull();
  });
});

describe('deduper', () => {
  const asExisting = (l: ParsedListing, id: number, url = l.source_url): ExistingRow => ({
    id,
    source_url: url,
    category: l.category,
    price_eur: l.price_eur!,
    photo_hash: photoFingerprint(l.photo_urls),
    photo_urls: l.photo_urls,
    attributes: l.attributes,
    title_hint: l.title_hint,
  });

  it('photoFingerprint uses the numeric photo id', () => {
    expect(photoFingerprint(['https://i.ss.com/gallery/8/1549/387154/flats-riga-purvciems-77430610.800.jpg'])).toBe('ssid:77430610');
    expect(photoFingerprint([])).toBeNull();
  });
  it('same URL is never a dup (writer update path)', () => {
    expect(findDuplicate(flat(), [asExisting(flat(), 1)])).toEqual({ dup: false });
  });
  it('same first photo under another URL → dup_photo', () => {
    expect(findDuplicate(flat(), [asExisting(flat(), 7, 'https://www.ss.com/msg/lv/real-estate/flats/riga/purvciems/zzzzz.html')])).toEqual({ dup: true, code: 'dup_photo', of: 7 });
  });
  it('same attributes + price within 3 % but different photos → dup_attrs; far price → no dup', () => {
    const other = { ...flat(), source_url: 'https://www.ss.com/msg/lv/real-estate/flats/riga/purvciems/yyyyy.html', photo_urls: ['https://i.ss.com/gallery/8/1/2/x-1.800.jpg', 'https://i.ss.com/gallery/8/1/2/x-2.800.jpg'] };
    expect(findDuplicate({ ...flat(), price_eur: 53000 }, [asExisting(other, 3)])).toEqual({ dup: true, code: 'dup_attrs', of: 3 });
    expect(findDuplicate({ ...flat(), price_eur: 60000 }, [asExisting(other, 3)])).toEqual({ dup: false });
    expect(attrFingerprint(flat())).toBe('flats|purvciems|2|50|1|5');
    expect(attrFingerprint(car())).toBe('cars|Volkswagen|touran|2012|diesel|44');
  });
  it('random: trigram title similarity + equal price', () => {
    expect(trigramSimilarity('Krēsli 2 gb. no masīvkoka', 'Krēsli 2 gb no masīvkoka')).toBeGreaterThan(0.8);
    expect(trigramSimilarity('Krēsli', 'Paklājs 300x400')).toBeLessThan(0.3);
    const other = { ...chair(), source_url: 'https://www.ss.com/msg/lv/home-stuff/furniture-interior/chairs/other.html', photo_urls: ['https://i.ss.com/gallery/1/1/1/a-1.800.jpg'] };
    expect(findDuplicate(chair(), [asExisting(other, 9)])).toEqual({ dup: true, code: 'dup_attrs', of: 9 });
    expect(findDuplicate({ ...chair(), price_eur: 55 }, [asExisting(other, 9)])).toEqual({ dup: false });
  });
  it('different categories never collide', () => {
    expect(findDuplicate(flat(), [asExisting(car(), 1)])).toEqual({ dup: false });
  });
});

describe('writer.toRow', () => {
  it('maps to docs/05 listings columns', () => {
    const r = toRow(flat(), new Date('2026-09-26T00:00:00Z'));
    expect(Object.keys(r).sort()).toEqual(['attributes', 'category', 'checked_at', 'first_seen_at', 'location', 'photo_hash', 'photo_urls', 'price_eur', 'region', 'source', 'source_url', 'status', 'title_hint'].sort());
    expect(r.status).toBe('active');
    expect(r.photo_hash).toMatch(/^ssid:\d+$/);
    expect(r.checked_at).toBe('2026-09-26T00:00:00.000Z');
    expect(() => toRow({ ...flat(), price_eur: null })).toThrow();
  });
});
