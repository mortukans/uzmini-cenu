import { describe, expect, it } from 'vitest';
import { detailIsGone, parseDetail, parseList, parseListHeaders, parseListPages } from '../src/parser/ss.ts';
import { URLS, fixture } from './helpers.ts';

describe('parseList', () => {
  it('flats: 30 rows with tr_ ids, title, 7 data cells, thumb', () => {
    const rows = parseList(fixture('flats/list-purvciems.html'));
    expect(rows).toHaveLength(30);
    const r = rows[0]!;
    expect(r.sourceUrl).toBe('https://www.ss.com/msg/lv/real-estate/flats/riga/purvciems/aemdn.html');
    expect(r.rowId).toBe('tr_58114044');
    expect(r.titleSnippet.length).toBeGreaterThan(10);
    expect(r.cells).toEqual(['Dzelzavas 95', '2', '50', '5/5', 'LT proj.', '1,360 €', '68,000 €']);
    expect(r.thumbUrl).toMatch(/^https:\/\/i\.ss\.com\/gallery\/.*\.th2\.jpg$/);
    expect(r.promoted).toBe(false);
    expect(new Set(rows.map((x) => x.sourceUrl)).size).toBe(30);
    for (const x of rows) expect(x.rowId).toMatch(/^tr_\d+$/);
  });

  it('cars: 30 rows, model/year/engine/km/price cells', () => {
    const rows = parseList(fixture('cars/list-audi.html'));
    expect(rows).toHaveLength(30);
    expect(rows[0]!.cells).toEqual(['Q3', '2016', '1.4', '175 tūkst.', '12,500 €']);
    expect(rows.every((r) => r.sourceUrl.includes('/msg/lv/transport/cars/audi/'))).toBe(true);
  });

  it('houses: 30 rows, <br> in location cell becomes a space', () => {
    const rows = parseList(fixture('houses/list-riga-region.html'));
    expect(rows).toHaveLength(30);
    expect(rows[0]!.cells[0]).toBe('Garkalnes nov. Bukulti');
    expect(rows[0]!.cells.at(-1)).toBe('33,000 €');
  });

  it('random: 30 rows, ads_region hint separated from the title', () => {
    const rows = parseList(fixture('random/list-chairs.html'));
    expect(rows).toHaveLength(30);
    expect(rows[0]!.regionHint).toBe('Rīgas rajons');
    expect(rows[0]!.titleSnippet).not.toContain('Rīgas rajons');
    expect(rows[0]!.cells).toEqual(['Psrs', 'lietota', '30 €']);
  });

  it('ignores hidden banner rows and returns nothing for an index page', () => {
    expect(parseList('<table><tr id="tr_bnr_1" style="display:none;"><td><a href="/msg/lv/x/y.html">x</a></td></tr></table>')).toHaveLength(0);
    expect(parseList('<html><body><a href="/lv/home-stuff/furniture-interior/chairs/">Krēsli</a></body></html>')).toHaveLength(0);
  });

  it('headers and pagination', () => {
    const html = fixture('flats/list-purvciems.html');
    expect(parseListHeaders(html)).toContain('Cena');
    const pages = parseListPages(html, URLS.flatsList);
    expect(pages).toContain(`${URLS.flatsList}page2.html`);
    expect(pages.every((p) => p.startsWith(URLS.flatsList))).toBe(true);
    expect(pages.some((p) => p.includes('/en/') || p.includes('/ru/'))).toBe(false);
  });
});

describe('parseDetail', () => {
  it('flat: attrs, price with ppm2, breadcrumb, photos, date, Vieta', () => {
    const d = parseDetail(fixture('flats/detail-hxnxd.html'), URLS.flatHxnxd);
    expect(d.breadcrumb).toEqual(['Dzīvokļi', 'Rīga', 'Purvciems', 'Pārdod']);
    expect(d.attrs).toMatchObject({ Pilsēta: 'Rīga', Rajons: 'Purvciems', Istabas: '2', Platība: '50 m²', Stāvs: '1/5', Sērija: 'LT proj.', 'Mājas tips': 'Paneļu', Ērtības: 'Lodžija, Parkošanas vieta' });
    expect(d.attrs['Iela']).toBe('Zvaigznāja g. 14'); // parser keeps it; normaliser drops it
    expect(d.attrs['Cena']).toBeUndefined();
    expect(d.priceText).toBe('52 000 € (1 040 €/m²)');
    expect(d.photoUrls.length).toBe(20);
    expect(d.photoUrls.every((p) => /\.800\.jpg$/.test(p))).toBe(true);
    expect(new Set(d.photoUrls).size).toBe(d.photoUrls.length);
    expect(d.postedAtText).toBe('24.09.2026 19:10');
    expect(d.locationText).toBe('Rīga');
    expect(d.descriptionLength).toBeGreaterThan(100);
    expect(d.notFound).toBe(false);
  });

  it('flat with lift: Stāvs "3/9/lifts", photos across two gallery dirs', () => {
    const d = parseDetail(fixture('flats/detail-agkkl.html'), URLS.flatAgkkl);
    expect(d.attrs['Stāvs']).toBe('3/9/lifts');
    expect(d.attrs['Rajons']).toBe('centrs');
    const dirs = new Set(d.photoUrls.map((p) => p.split('/')[6]));
    expect(dirs.size).toBeGreaterThan(1);
  });

  it('car: Marka without colon, nested span.ads_price, insurance link stripped, features by section', () => {
    const d = parseDetail(fixture('cars/detail-touran-cdegbp.html'), URLS.carTouran);
    expect(d.attrs['Marka']).toBe('Volkswagen Touran');
    expect(d.attrs['Izlaiduma gads']).toBe('2012 novembris');
    expect(d.attrs['Motors']).toBe('1.6 dīzelis');
    expect(d.attrs['Ātrumkārba']).toBe('Automāts 7 ātrumi');
    expect(d.attrs['Nobraukums, km']).toBe('218 400');
    expect(d.attrs['Tehniskā apskate']).toBe('03.2027');
    expect(d.priceText).toBe('4 900 €');
    expect(d.breadcrumb).toEqual(['Vieglie auto', 'Volkswagen', 'Touran', 'Pārdod']);
    expect(d.photoUrls).toHaveLength(16);
    expect(d.features).toBeDefined();
    expect(Object.keys(d.features!)).toContain('Aprīkojums');
    expect(d.features!['Aprīkojums']).toContain('Kondicionieris');
    expect(d.features!['Gaismas'] ?? d.features!['Sēdekļi']).toBeDefined();
    expect(d.locationText).toBe('Rīga');
  });

  it('electric car: Dzinēja tips instead of Motors', () => {
    const d = parseDetail(fixture('cars/detail-etron-cgnggi.html'), URLS.carEtron);
    expect(d.attrs['Motors']).toBeUndefined();
    expect(d.attrs['Dzinēja tips']).toBe('Elektriskais');
    expect(d.priceText).toBe('24 600 €');
  });

  it('house: houses labels, Ciems, land area, Vieta = Rīgas rajons', () => {
    const d = parseDetail(fixture('houses/detail-baltezers-doxdi.html'), URLS.houseBaltezers);
    expect(d.attrs).toMatchObject({ 'Pilsēta/pagasts': 'Garkalnes nov.', 'Pilsēta, rajons': 'Rīgas rajons', Ciems: 'Baltezers', Platība: '281 m²', 'Stāvu skaits': '2', Istabas: '7', 'Zemes platība': '2330 m²' });
    expect(d.attrs['Iela']).toBe('Anetes iela'); // [Karte] stripped
    expect(d.priceText).toBe('430 000 €');
    expect(d.locationText).toBe('Rīgas rajons');
    expect(d.breadcrumb.at(-1)).toBe('Pārdod');
  });

  it('random: only Ražotājs/Stāvoklis, dealer Adrese present but Vieta parsed', () => {
    const d = parseDetail(fixture('random/detail-chairs-bhmxgd.html'), URLS.chair);
    expect(d.attrs).toEqual({ Ražotājs: 'Vācija', Stāvoklis: 'lietota' });
    expect(d.priceText).toBe('50 €');
    expect(d.locationText).toBe('Valmiera un raj.');
    expect(d.photoUrls).toHaveLength(6);
    const c = parseDetail(fixture('random/detail-carpets-bdmmon.html'), URLS.carpet);
    expect(c.attrs['Platums x Garums']).toBe('300x400');
    expect(c.photoUrls).toHaveLength(3);
  });

  it('never reads phones or e-mails into attrs', () => {
    for (const [f, u] of [
      ['flats/detail-hxnxd.html', URLS.flatHxnxd],
      ['cars/detail-touran-cdegbp.html', URLS.carTouran],
      ['random/detail-chairs-bhmxgd.html', URLS.chair],
    ] as const) {
      const d = parseDetail(fixture(f), u);
      const blob = JSON.stringify({ ...d.attrs, loc: d.locationText, price: d.priceText });
      expect(blob).not.toMatch(/\+371|Tālrunis|@/);
    }
  });

  it('not-found pages', () => {
    const gone = '<html><body><h2 class="headtitle">Dzīvokļi</h2><div>Sludinājums nav atrasts vai ir dzēsts.</div></body></html>';
    expect(parseDetail(gone, URLS.flatHxnxd).notFound).toBe(true);
    expect(detailIsGone(200, gone)).toBe(true);
    expect(detailIsGone(404, '')).toBe(true);
    expect(detailIsGone(200, fixture('flats/detail-hxnxd.html'))).toBe(false);
  });
});
