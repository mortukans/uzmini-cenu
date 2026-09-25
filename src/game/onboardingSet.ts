/**
 * Bundled offline practice set for onboarding (docs/11 §2.1): one flat, one
 * car, one random item, scored locally. Used when get_rounds is slow/offline.
 * Prices are typical 2026 asking prices, not live listings; photos are empty
 * so the carousel shows the category glyph.
 */
import type { Round } from '../api/types';

export type OfflineRound = Round & { price_eur: number };

export const ONBOARDING_SET: OfflineRound[] = [
  {
    id: -1, category: 'flats', region: 'riga', location: 'Purvciems',
    attributes: { rooms: 3, m2: 65, floor: 5, floors_total: 9, series: '602. sērija' },
    title_hint: null, photo_urls: [], source: 'SS.com', source_url: 'https://www.ss.com/lv/real-estate/flats/riga/purvciems/',
    token: 'offline-1', price_eur: 78_500,
  },
  {
    id: -2, category: 'cars', region: 'riga', location: 'Rīga',
    attributes: { make: 'Volkswagen', model: 'Golf', year: 2008, engine_l: 1.9, fuel: 'diesel', gearbox: 'manual', km: 245_000 },
    title_hint: null, photo_urls: [], source: 'SS.com', source_url: 'https://www.ss.com/lv/transport/cars/volkswagen/golf/',
    token: 'offline-2', price_eur: 4_200,
  },
  {
    id: -3, category: 'random', region: 'riga', location: 'Rīga',
    attributes: { subcategory: 'Mēbeles › Dīvāni', condition: 'Lietots' },
    title_hint: 'Dīvāns, lietots, labā stāvoklī', photo_urls: [], source: 'SS.com', source_url: 'https://www.ss.com/lv/home-stuff/furniture-interior/sofas/',
    token: 'offline-3', price_eur: 35,
  },
];
