/**
 * Shared scraper types (docs/12-ss-scraper-spec.md "Parsed listing interface").
 * `ListingAttributes` mirrors src/api/types.ts key-for-key so the app never
 * cares which source produced a row.
 */

export type SsCategory = 'flats' | 'houses' | 'cars' | 'land' | 'random';
export type Deal = 'sell' | 'rent' | 'buy' | 'change' | 'other';
export type Region = 'riga' | 'riga_region' | 'latvia';

/** One row of a list page, strings exactly as found. */
export interface SsRawListRow {
  sourceUrl: string; // absolute https://www.ss.com/msg/lv/...
  rowId?: string; // tr_NNNNNNNN
  titleSnippet: string;
  cells: string[]; // data <td> texts after the title cell, verbatim
  thumbUrl?: string;
  promoted: boolean;
  /** `div.ads_region` text inside the title cell (random category shows it). */
  regionHint?: string;
}

/** A detail page, strings exactly as found. */
export interface SsRawDetail {
  sourceUrl: string;
  breadcrumb: string[]; // ['Dzīvokļi','Rīga','Purvciems','Pārdod']
  attrs: Record<string, string>; // 'Platība' -> '50 m²', labels without trailing colon
  priceText: string; // '68 000 € (1 360 €/m²)'
  photoUrls: string[]; // .800.jpg, page order, deduped
  postedAtText?: string; // '25.09.2026 11:03'
  locationText?: string; // `Vieta`: 'Rīga', 'Valka un raj.', 'Rīgas rajons'
  features?: Record<string, string[]>; // cars: section -> checked items
  descriptionLength: number; // stats only; text is never kept
  /** Page says the ad is gone ("Sludinājums nav atrasts" etc). */
  notFound: boolean;
}

/** List row + optional detail, before normalisation. */
export interface RawListing {
  category: SsCategory;
  listUrl: string;
  row: SsRawListRow;
  detail?: SsRawDetail;
}

export type Fuel = 'petrol' | 'diesel' | 'lpg' | 'hybrid' | 'electric';
export type Gearbox = 'auto' | 'manual';

export interface ListingAttributes {
  // flats / houses
  district?: string; // slug, riga only
  town?: string;
  rooms?: number;
  m2?: number;
  land_m2?: number;
  floor?: number;
  floors_total?: number;
  elevator?: boolean;
  series?: string;
  house_type?: string;
  amenities?: string[];
  // cars
  make?: string;
  model?: string;
  year?: number;
  engine_l?: number;
  fuel?: Fuel;
  gearbox?: Gearbox;
  km?: number;
  color?: string;
  body?: string;
  inspection_until?: string; // '2027-04'
  trim_hint?: string; // never shown
  // random
  subcategory?: string;
  condition?: string;
  manufacturer?: string;
  // pipeline
  dealer?: boolean;
  promoted?: boolean;
  dup_of?: number;
  _raw?: Record<string, string>; // dropped after 30 d
}

export interface ParsedListing {
  source: 'ss';
  source_url: string;
  category: SsCategory;
  deal: Deal;
  price_eur: number | null;
  region: Region | null;
  location: string | null; // canonical lv district / town
  attributes: ListingAttributes;
  title_hint: string | null;
  photo_urls: string[];
  posted_at: string | null; // ISO
}

/** Reject reason codes (docs/03 "Quality filters"). */
export type RejectCode =
  | 'price_low'
  | 'price_high'
  | 'price_missing'
  | 'price_not_eur'
  | 'missing_attr'
  | 'few_photos'
  | 'no_year'
  | 'deal_rent'
  | 'deal_buy'
  | 'deal_change'
  | 'deal_other'
  | 'deal_mismatch'
  | 'ppm2_outlier'
  | 'm2_outlier'
  | 'rooms_outlier'
  | 'km_outlier'
  | 'unknown_make'
  | 'random_excluded'
  | 'title_leak'
  | 'pii_leak'
  | 'dup_url'
  | 'dup_photo'
  | 'dup_attrs';

export type QualityResult = { ok: true; listing: ParsedListing } | { ok: false; reject: RejectCode; detail?: string };

export interface FetchResult {
  url: string;
  finalUrl: string;
  status: number;
  html: string;
  fetchedAt: string;
  elapsedMs: number;
  fromCache: boolean;
  location: string | null;
}

/** Column shape of `scrape_runs` (docs/03 Monitoring). */
export interface ScrapeRunRow {
  id?: number;
  source: string;
  started_at?: string;
  finished_at?: string | null;
  requests: number;
  new_rows: number;
  updated_rows: number;
  expired_rows: number;
  rejected: Record<string, number>;
  errors: number;
  blocked_until?: string | null;
  notes?: string | null;
}
