import { describe, expect, it } from 'vitest';
import { districtByName, districtFromUrl } from '../src/districts.ts';
import {
  canonicalMake,
  canonicalModel,
  carUrlSegments,
  dealFromBreadcrumb,
  dealFromUrl,
  normalise,
  parseEngine,
  parseFloor,
  parseGearbox,
  parseInspection,
  parseKm,
  parseM2,
  parsePostedAt,
  parsePrice,
  parseYear,
  rawFromDetail,
  regionFromLocation,
  scrubTitle,
  splitMakeModel,
  titleLeaks,
  townFromLocation,
} from '../src/normaliser.ts';
import { parseDetail, parseList } from '../src/parser/ss.ts';
import type { RawListing } from '../src/types.ts';
import { URLS, fixture } from './helpers.ts';

describe('parsePrice', () => {
  it.each([
    ['68 000 €', 68000],
    ['68,000 €', 68000],
    ['68,000  €', 68000],
    ['68 000 €', 68000],
    ['68.000 €', 68000],
    ['1,360 €', 1360],
    ['52 000 € (1 040 €/m²)', 52000],
    ['4 900 €*PVN iekļauts', 4900],
    ['4 900 €Aprēķināt apdrošināšanu', 4900],
    ['24 600 €', 24600],
    ['30  €', 30],
    ['1 250 000 €', 1250000],
    ['12500 EUR', 12500],
  ])('%s → %d', (text, eur) => {
    const p = parsePrice(text);
    expect(p.kind).toBe('sell');
    expect(p.eur).toBe(eur);
  });

  it('flags VAT', () => expect(parsePrice('4 900 €*PVN iekļauts').vatIncluded).toBe(true));

  it.each([
    ['450 €/mēn.', 'rent'],
    ['25 €/dienā', 'rent'],
    ['450 € mēnesī', 'rent'],
    ['pērku', 'buy'],
    ['pērk', 'buy'],
    ['maiņa', 'change'],
    ['mainu', 'change'],
    ['vienojoties', 'missing'],
    ['pēc vienošanās', 'missing'],
    ['договорная', 'missing'],
    ['', 'missing'],
    ['0 €', 'missing'],
    ['-', 'missing'],
    ['5 000 Ls', 'not_eur'],
    ['abc 123', 'unparsed'],
  ])('%s → %s', (text, kind) => {
    const p = parsePrice(text);
    expect(p.kind).toBe(kind);
    expect(p.eur).toBeNull();
  });
});

describe('numeric helpers', () => {
  it('parseM2', () => {
    expect(parseM2('50 m²')).toBe(50);
    expect(parseM2('50.5 m2')).toBe(50.5);
    expect(parseM2('50,5 kv.m')).toBe(50.5);
    expect(parseM2('1725 m²')).toBe(1725);
    expect(parseM2('1.2 ha')).toBe(12000);
    expect(parseM2('-')).toBeUndefined();
  });
  it('parseFloor', () => {
    expect(parseFloor('5/5')).toEqual({ floor: 5, floors_total: 5, elevator: undefined });
    expect(parseFloor('1/9 (lifts)')).toEqual({ floor: 1, floors_total: 9, elevator: true });
    expect(parseFloor('3/9/lifts')).toEqual({ floor: 3, floors_total: 9, elevator: true });
    expect(parseFloor('pagr./5')).toMatchObject({ floor: 0, floors_total: 5 });
    expect(parseFloor('0')).toMatchObject({ floor: 0 });
    expect(parseFloor('3')).toMatchObject({ floor: 3, floors_total: undefined });
  });
  it('parseYear', () => {
    expect(parseYear('2007 marts')).toBe(2007);
    expect(parseYear('2007 g.')).toBe(2007);
    expect(parseYear('2012 novembris')).toBe(2012);
    expect(parseYear('1899')).toBeUndefined();
    expect(parseYear('n/a')).toBeUndefined();
  });
  it('parseKm', () => {
    expect(parseKm('345 tūkst.')).toBe(345000);
    expect(parseKm('175 тыс.')).toBe(175000);
    expect(parseKm('218 400')).toBe(218400);
    expect(parseKm('345 000')).toBe(345000);
    expect(parseKm('-')).toBeUndefined();
    expect(parseKm(undefined)).toBeUndefined();
  });
  it('parseEngine', () => {
    expect(parseEngine('3.0 dīzelis')).toEqual({ engine_l: 3, fuel: 'diesel' });
    expect(parseEngine('1.6 dīzelis')).toEqual({ engine_l: 1.6, fuel: 'diesel' });
    expect(parseEngine('2.0 benzīns')).toEqual({ engine_l: 2, fuel: 'petrol' });
    expect(parseEngine('2.0D')).toEqual({ engine_l: 2, fuel: 'diesel' });
    expect(parseEngine('2.3')).toEqual({ engine_l: 2.3, fuel: 'petrol' });
    expect(parseEngine('1.4 gāze/benzīns')).toEqual({ engine_l: 1.4, fuel: 'lpg' });
    expect(parseEngine('2.5 hibrīds')).toEqual({ engine_l: 2.5, fuel: 'hybrid' });
    expect(parseEngine('Elektriskais')).toEqual({ fuel: 'electric' });
    expect(parseEngine('E')).toEqual({ fuel: 'electric' });
  });
  it('parseGearbox / parseInspection / parsePostedAt', () => {
    expect(parseGearbox('Automāts 7 ātrumi')).toBe('auto');
    expect(parseGearbox('Manuāla')).toBe('manual');
    expect(parseGearbox(undefined)).toBeUndefined();
    expect(parseInspection('04.2027')).toBe('2027-04');
    expect(parsePostedAt('25.09.2026 11:03')).toBe('2026-09-25T08:03:00.000Z'); // EEST
    expect(parsePostedAt('15.01.2026 11:03')).toBe('2026-01-15T09:03:00.000Z'); // EET
    expect(parsePostedAt(undefined)).toBeNull();
  });
});

describe('region / location / districts', () => {
  it('regionFromLocation', () => {
    expect(regionFromLocation('Rīga')).toBe('riga');
    expect(regionFromLocation('Jūrmala')).toBe('riga_region');
    expect(regionFromLocation('Rīgas rajons')).toBe('riga_region');
    expect(regionFromLocation('Valka un raj.')).toBe('latvia');
    expect(regionFromLocation('Talsi un raj.')).toBe('latvia');
    expect(regionFromLocation(undefined)).toBeNull();
  });
  it('townFromLocation', () => {
    expect(townFromLocation('Valka un raj.')).toBe('Valka');
    expect(townFromLocation('Daugavpils un raj.')).toBe('Daugavpils');
    expect(townFromLocation('Rīgas rajons')).toBe('Rīgas rajons');
  });
  it('district table lv/ru/slug/url', () => {
    expect(districtByName('Purvciems')?.slug).toBe('purvciems');
    expect(districtByName('centrs')?.slug).toBe('centre');
    expect(districtByName('Пурвциемс')?.slug).toBe('purvciems');
    expect(districtByName('Pļavnieki')?.lv).toBe('Pļavnieki');
    expect(districtByName('Jugla')?.slug).toBe('yugla');
    expect(districtByName('Maskačka')?.slug).toBe('maskavas-priekshpilseta');
    expect(districtByName('Dzirciems')?.slug).toBe('dzeguzhkalns');
    expect(districtFromUrl(URLS.flatAgkkl)?.slug).toBe('centre');
    expect(districtByName('Nowhere')).toBeUndefined();
  });
});

describe('scrubTitle', () => {
  it('removes prices and phones, keeps words, truncates at 80', () => {
    expect(scrubTitle('Pārdod dzīvokli 68 000 € Purvciemā')).toBe('Pārdod dzīvokli Purvciemā');
    expect(scrubTitle('Cena 68000 EUR, zvanīt 26123456')).toBeNull();
    expect(scrubTitle('Cena: 68 000 €')).toBeNull();
    expect(scrubTitle('Pārdod Golf, cena 4900 €')).toBe('Pārdod Golf');
    expect(scrubTitle('Audi A4, 2 500 Eur, tel. +371 26 123 456')).toBe('Audi A4');
    expect(scrubTitle('Golf 5k, e-pasts test@example.com')).toBe('Golf, e-pasts');
    expect(scrubTitle('SIA "Nami" pārdod māju 120 tūkst.')).toBe('pārdod māju');
    expect(scrubTitle('a'.repeat(50) + ' ' + 'b'.repeat(50))!.length).toBeLessThanOrEqual(80);
    expect(scrubTitle('Pārdodu Padomju laika masīvkoka krēslus. Pavisam kopā 15g.')).toBe('Pārdodu Padomju laika masīvkoka krēslus. Pavisam kopā 15g.');
    expect(scrubTitle(null)).toBeNull();
  });
  it('titleLeaks', () => {
    expect(titleLeaks('dzīvoklis 68000 €')).toBe(true);
    expect(titleLeaks('dzīvoklis 2 istabas')).toBe(false);
    expect(titleLeaks(null)).toBe(false);
  });
});

describe('cars canonicalisation', () => {
  it('make from URL, model from URL, trims from Marka', () => {
    expect(carUrlSegments(URLS.carTouran)).toEqual({ make: 'volkswagen', model: 'touran' });
    expect(carUrlSegments('https://www.ss.com/msg/lv/transport/cars/audi/a4/bbifnf.html')).toEqual({ make: 'audi', model: 'a4' });
    expect(canonicalMake('mercedes')).toBe('Mercedes-Benz');
    expect(canonicalMake('land-rover')).toBe('Land Rover');
    expect(canonicalMake('vaz')).toBe('VAZ (Lada)');
    expect(canonicalMake('others')).toBeUndefined();
    expect(canonicalModel('a4')).toBe('A4');
    expect(canonicalModel('q7')).toBe('Q7');
    expect(canonicalModel('e-tron')).toBe('e-tron');
    expect(canonicalModel('touran')).toBe('Touran');
    expect(canonicalModel('golf-plus')).toBe('Golf Plus');
    expect(splitMakeModel('Volkswagen Touran', 'Volkswagen')).toEqual({ model: 'Touran', trim_hint: undefined });
    expect(splitMakeModel('Audi A4 S-line Quattro', 'Audi')).toEqual({ model: 'A4', trim_hint: 'S-line Quattro' });
  });
  it('deal detection', () => {
    expect(dealFromUrl(URLS.carsList)).toBe('sell');
    expect(dealFromUrl('https://www.ss.com/lv/real-estate/flats/riga/centre/hand_over/')).toBe('rent');
    expect(dealFromUrl('https://www.ss.com/lv/transport/cars/exchange/')).toBe('change');
    expect(dealFromBreadcrumb(['Dzīvokļi', 'Rīga', 'Pārdod'])).toBe('sell');
    expect(dealFromBreadcrumb(['Dzīvokļi', 'Rīga', 'Izīrē'])).toBe('rent');
    expect(dealFromBreadcrumb(['Dzīvokļi', 'Rīga', 'Pērk'])).toBe('buy');
    expect(dealFromBreadcrumb(['Dzīvokļi', 'Rīga', 'Maina'])).toBe('change');
  });
});

describe('normalise (fixtures end to end)', () => {
  const flatsRows = parseList(fixture('flats/list-purvciems.html'));

  it('flat: list row + detail', () => {
    const row = flatsRows.find((r) => r.sourceUrl === URLS.flatHxnxd)!;
    const raw: RawListing = { category: 'flats', listUrl: URLS.flatsList, row, detail: parseDetail(fixture('flats/detail-hxnxd.html'), URLS.flatHxnxd) };
    const l = normalise(raw);
    expect(l).toMatchObject({ source: 'ss', source_url: URLS.flatHxnxd, category: 'flats', deal: 'sell', price_eur: 52000, region: 'riga', location: 'Purvciems' });
    expect(l.attributes).toMatchObject({ district: 'purvciems', rooms: 2, m2: 50, floor: 1, floors_total: 5, series: 'LT proj.', house_type: 'Paneļu', amenities: ['Lodžija', 'Parkošanas vieta'] });
    expect(l.attributes.elevator).toBeUndefined();
    expect(l.attributes.town).toBeUndefined();
    expect(l.photo_urls).toHaveLength(8);
    expect(l.posted_at).toBe('2026-09-24T16:10:00.000Z');
    expect(l.title_hint).toBeTruthy();
    // never stored
    const blob = JSON.stringify(l);
    expect(blob).not.toContain('Zvaigznāja');
    expect(blob).not.toContain('Iela');
    expect(blob).not.toMatch(/\+371/);
    expect(l.attributes._raw).toBeDefined();
    expect(l.attributes._raw!['Iela']).toBeUndefined();
  });

  it('flat: elevator from "3/9/lifts", district "centrs" → centre/Centrs', () => {
    const l = normalise(rawFromDetail('flats', 'https://www.ss.com/lv/real-estate/flats/riga/centre/sell/', parseDetail(fixture('flats/detail-agkkl.html'), URLS.flatAgkkl)));
    expect(l.attributes).toMatchObject({ district: 'centre', floor: 3, floors_total: 9, elevator: true, rooms: 4, m2: 105 });
    expect(l.location).toBe('Centrs');
    expect(l.price_eur).toBe(249900);
  });

  it('flat: list-only row (no detail) still yields price/rooms/m2/floor/series from comma-priced cells', () => {
    const l = normalise({ category: 'flats', listUrl: URLS.flatsList, row: flatsRows[0]! }, { keepRaw: false });
    expect(l.price_eur).toBe(68000);
    expect(l.attributes).toMatchObject({ rooms: 2, m2: 50, floor: 5, floors_total: 5, series: 'LT proj.', district: 'purvciems' });
    expect(l.region).toBe('riga');
    expect(l.attributes._raw).toBeUndefined();
    expect(JSON.stringify(l)).not.toContain('Dzelzavas');
  });

  it('car: make/model from URL, year with month, engine, gearbox with gear count, km, inspection', () => {
    const l = normalise(rawFromDetail('cars', 'https://www.ss.com/lv/transport/cars/volkswagen/sell/', parseDetail(fixture('cars/detail-touran-cdegbp.html'), URLS.carTouran), 'Pārdod VW Touran 1.6 Tdi, cena 4900 €'));
    expect(l.attributes).toMatchObject({ make: 'Volkswagen', model: 'Touran', year: 2012, engine_l: 1.6, fuel: 'diesel', gearbox: 'auto', km: 218400, color: 'Sudraba', body: 'Universāls', inspection_until: '2027-03' });
    expect(l.region).toBe('riga');
    expect(l.location).toBe('Rīga');
    expect(l.attributes.district).toBeUndefined();
    expect(l.title_hint).toBe('Pārdod VW Touran 1.6 Tdi');
    expect(JSON.stringify(l.attributes)).not.toMatch(/VIN|numura/);
  });

  it('electric car: fuel electric, no engine_l, model exception e-tron', () => {
    const l = normalise(rawFromDetail('cars', URLS.carsList, parseDetail(fixture('cars/detail-etron-cgnggi.html'), URLS.carEtron)));
    expect(l.attributes).toMatchObject({ make: 'Audi', model: 'e-tron', year: 2020, fuel: 'electric', gearbox: 'auto', km: 79800 });
    expect(l.attributes.engine_l).toBeUndefined();
  });

  it('car list row (no detail): km from "175 tūkst.", engine from "1.4", model from list cell', () => {
    const rows = parseList(fixture('cars/list-audi.html'));
    const l = normalise({ category: 'cars', listUrl: URLS.carsList, row: rows[0]! });
    expect(l.attributes).toMatchObject({ make: 'Audi', model: 'Q3', year: 2016, engine_l: 1.4, fuel: 'petrol', km: 175000 });
    expect(l.price_eur).toBe(12500);
    const diesel = normalise({ category: 'cars', listUrl: URLS.carsList, row: rows[1]! });
    expect(diesel.attributes.fuel).toBe('diesel');
  });

  it('house: town from Pilsēta/pagasts, region riga_region, land_m2, floors_total', () => {
    const l = normalise(rawFromDetail('houses', URLS.housesList, parseDetail(fixture('houses/detail-sigulda-dclid.html'), URLS.houseSigulda)));
    expect(l).toMatchObject({ region: 'riga_region', location: 'Sigulda', price_eur: 75000 });
    expect(l.attributes).toMatchObject({ town: 'Sigulda', m2: 54, land_m2: 1000, floors_total: 1, rooms: 2, amenities: ['Boileris', 'Dārzs', 'Krāsns apkure'] });
    expect(JSON.stringify(l)).not.toContain('Lakstīgalas');
    expect(JSON.stringify(l)).not.toContain('Kadastra');
  });

  it('random: subcategory from URL, manufacturer, condition, region latvia from "Valmiera un raj."', () => {
    const l = normalise(rawFromDetail('random', URLS.randomList, parseDetail(fixture('random/detail-chairs-bhmxgd.html'), URLS.chair), 'Krēsli 2 gb. no masīvkoka, 50 € par abiem'));
    expect(l).toMatchObject({ region: 'latvia', location: 'Valmiera', price_eur: 50, title_hint: 'Krēsli 2 gb. no masīvkoka, par abiem' });
    expect(l.attributes).toMatchObject({ subcategory: 'chairs', manufacturer: 'Vācija', condition: 'used', town: 'Valmiera' });
    expect(JSON.stringify(l)).not.toContain('Abula'); // dealer Adrese
    expect(l.attributes.dealer).toBeUndefined(); // no Uzņēmums label on this page
  });

  it('random list row: region hint from ads_region', () => {
    const rows = parseList(fixture('random/list-chairs.html'));
    const l = normalise({ category: 'random', listUrl: URLS.randomList, row: rows[0]! });
    expect(l.region).toBe('riga_region');
    expect(l.price_eur).toBe(30);
    expect(l.attributes.subcategory).toBe('chairs');
    expect(l.attributes.condition).toBe('used');
  });

  it('deal override from price text: rent under /sell/ → rent', () => {
    const d = parseDetail(fixture('flats/detail-hxnxd.html'), URLS.flatHxnxd);
    const l = normalise(rawFromDetail('flats', URLS.flatsList, { ...d, priceText: '450 €/mēn.' }));
    expect(l.deal).toBe('rent');
    expect(l.price_eur).toBeNull();
    const buy = normalise(rawFromDetail('flats', URLS.flatsList, { ...d, breadcrumb: ['Dzīvokļi', 'Rīga', 'Purvciems', 'Pērk'], priceText: 'pērku' }));
    expect(buy.deal).toBe('buy');
  });
});
