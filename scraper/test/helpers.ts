import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const fixture = (rel: string) => readFileSync(join(here, 'fixtures', rel), 'utf8');

export const URLS = {
  flatsList: 'https://www.ss.com/lv/real-estate/flats/riga/purvciems/sell/',
  flatHxnxd: 'https://www.ss.com/msg/lv/real-estate/flats/riga/purvciems/hxnxd.html',
  flatAgkkl: 'https://www.ss.com/msg/lv/real-estate/flats/riga/centre/agkkl.html',
  carsList: 'https://www.ss.com/lv/transport/cars/audi/sell/',
  carTouran: 'https://www.ss.com/msg/lv/transport/cars/volkswagen/touran/cdegbp.html',
  carEtron: 'https://www.ss.com/msg/lv/transport/cars/audi/e-tron/cgnggi.html',
  housesList: 'https://www.ss.com/lv/real-estate/homes-summer-residences/riga-region/all/sell/',
  houseSigulda: 'https://www.ss.com/msg/lv/real-estate/homes-summer-residences/riga-region/sigulda/dclid.html',
  houseBaltezers: 'https://www.ss.com/msg/lv/real-estate/homes-summer-residences/riga-region/garkalnes-nov/baltezers/doxdi.html',
  randomList: 'https://www.ss.com/lv/home-stuff/furniture-interior/chairs/sell/',
  chair: 'https://www.ss.com/msg/lv/home-stuff/furniture-interior/chairs/bhmxgd.html',
  carpet: 'https://www.ss.com/msg/lv/home-stuff/furniture-interior/carpets/bdmmon.html',
};
