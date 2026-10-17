/**
 * src/game/filters: normalisation, the base64url sessionId segment and the
 * human-readable summary shown on the home tiles.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTERS, type ListingFilters } from '../api/types';
import {
  base64urlDecode, base64urlEncode, decodeFiltersSegment, describeFilters, describeSelection, encodeFiltersSegment,
  isDefaultFilters, nonDefaultFilters, normalizeFilters,
} from './filters';

/** Minimal t(): resolves the keys this module uses to English-ish labels. */
const labels: Record<string, string> = {
  'filters.period.24h': '24 h', 'filters.period.7d': '7 d', 'filters.period.30d': '30 d', 'filters.period.all': 'All',
  'filters.sort.random': 'Random', 'filters.sort.newest': 'Newest', 'filters.sort.price_asc': 'Price ↑', 'filters.sort.price_desc': 'Price ↓',
  'category.cars': 'Cars', 'category.flats': 'Flats', 'category.all': 'All', 'region.riga': 'Riga', 'region.latvia': 'Latvia',
};
const t = (k: string) => labels[k] ?? k;

describe('base64url', () => {
  it('round-trips ASCII, spaces and non-ASCII, with the URL-safe alphabet and no padding', () => {
    for (const s of ['', 'a', 'ab', 'abc', 'abcd', 'Mercedes-Benz', 'Škoda Octavia', 'ВАЗ 2107', '{"make":"Citroën"}', '😀 emoji', '???>>>']) {
      const enc = base64urlEncode(s);
      expect(enc).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(enc).toBe(Buffer.from(s, 'utf8').toString('base64url'));
      expect(base64urlDecode(enc)).toBe(s);
    }
  });
  it('rejects invalid input', () => {
    expect(() => base64urlDecode('a')).toThrow();
    expect(() => base64urlDecode('ab+/')).toThrow();
    expect(() => base64urlDecode('%%')).toThrow();
  });
});

describe('normalizeFilters', () => {
  it('fills defaults and drops unknown values', () => {
    expect(normalizeFilters(null)).toEqual(DEFAULT_FILTERS);
    expect(normalizeFilters(undefined)).toEqual(DEFAULT_FILTERS);
    expect(normalizeFilters({ period: '1y' as never, sort: 'cheapest' as never })).toEqual(DEFAULT_FILTERS);
    expect(normalizeFilters({ period: '7d', sort: 'price_asc' })).toEqual({ period: '7d', sort: 'price_asc' });
  });
  it('keeps make/model only for cars (or when the category is unknown), model only with a make', () => {
    const f: ListingFilters = { period: 'all', sort: 'random', make: ' BMW ', model: 'X5' };
    expect(normalizeFilters(f, 'cars')).toEqual({ period: 'all', sort: 'random', make: 'BMW', model: 'X5' });
    expect(normalizeFilters(f)).toEqual({ period: 'all', sort: 'random', make: 'BMW', model: 'X5' });
    expect(normalizeFilters(f, 'flats')).toEqual(DEFAULT_FILTERS);
    expect(normalizeFilters(f, 'all')).toEqual(DEFAULT_FILTERS);
    expect(normalizeFilters({ period: 'all', sort: 'random', model: 'X5' }, 'cars')).toEqual(DEFAULT_FILTERS);
    expect(normalizeFilters({ period: 'all', sort: 'random', make: null, model: 'X5' }, 'cars')).toEqual(DEFAULT_FILTERS);
    expect(normalizeFilters({ period: 'all', sort: 'random', make: '', model: '' }, 'cars')).toEqual(DEFAULT_FILTERS);
  });
});

describe('isDefaultFilters / nonDefaultFilters', () => {
  it('treats null make/model as default', () => {
    expect(isDefaultFilters(DEFAULT_FILTERS)).toBe(true);
    expect(isDefaultFilters({ period: 'all', sort: 'random', make: null, model: null })).toBe(true);
    expect(isDefaultFilters({ period: '7d', sort: 'random' })).toBe(false);
    expect(isDefaultFilters({ period: 'all', sort: 'random', make: 'BMW' })).toBe(false);
    expect(nonDefaultFilters({ period: 'all', sort: 'newest', make: 'BMW', model: 'X5' })).toEqual({ sort: 'newest', make: 'BMW', model: 'X5' });
    expect(nonDefaultFilters({ period: 'all', sort: 'random', model: 'X5' })).toEqual({});
  });
});

describe('filters segment', () => {
  it('is empty for default filters and round-trips otherwise', () => {
    expect(encodeFiltersSegment(undefined)).toBe('');
    expect(encodeFiltersSegment(DEFAULT_FILTERS)).toBe('');
    const f: ListingFilters = { period: '24h', sort: 'price_desc', make: 'Mercedes-Benz', model: 'E 220' };
    const seg = encodeFiltersSegment(f);
    expect(seg).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeFiltersSegment(seg, 'cars')).toEqual(f);
    expect(decodeFiltersSegment(seg, 'flats')).toEqual({ period: '24h', sort: 'price_desc' });
  });
  it('falls back to defaults on garbage', () => {
    expect(decodeFiltersSegment('')).toEqual(DEFAULT_FILTERS);
    expect(decodeFiltersSegment(undefined)).toEqual(DEFAULT_FILTERS);
    expect(decodeFiltersSegment('!!!')).toEqual(DEFAULT_FILTERS);
    expect(decodeFiltersSegment(base64urlEncode('null'))).toEqual(DEFAULT_FILTERS);
    expect(decodeFiltersSegment(base64urlEncode('"x"'))).toEqual(DEFAULT_FILTERS);
    expect(decodeFiltersSegment(base64urlEncode('{not json'))).toEqual(DEFAULT_FILTERS);
  });
});

describe('describeFilters', () => {
  it('lists only the non-default parts: period, make + model, sort', () => {
    expect(describeFilters(DEFAULT_FILTERS, t)).toEqual([]);
    expect(describeFilters({ period: '7d', sort: 'random' }, t)).toEqual(['7 d']);
    expect(describeFilters({ period: 'all', sort: 'newest' }, t)).toEqual(['Newest']);
    expect(describeFilters({ period: 'all', sort: 'random', make: 'BMW' }, t)).toEqual(['BMW']);
    expect(describeFilters({ period: '7d', sort: 'price_asc', make: 'BMW', model: 'X5' }, t)).toEqual(['7 d', 'BMW X5', 'Price ↑']);
    // a model without a make is never shown on its own
    expect(describeFilters({ period: 'all', sort: 'random', model: 'X5' }, t)).toEqual([]);
  });
  it('describeSelection builds the tile subtitle', () => {
    expect(describeSelection('cars', 'riga', { period: '7d', sort: 'random', make: 'BMW', model: 'X5' }, t)).toBe('Cars · Riga · 7 d · BMW X5');
    expect(describeSelection('flats', 'riga', DEFAULT_FILTERS, t)).toBe('Flats · Riga');
    expect(describeSelection('all', null, { period: 'all', sort: 'newest' }, t)).toBe('All · Newest');
  });
});
