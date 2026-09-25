import type { Category, Lang } from '../api/types';

/** `78 500 €` in lv/ru, `€78,500` in en (docs/02 §1.2). */
export function formatEur(n: number | null | undefined, lang: Lang = 'lv'): string {
  if (n == null || !Number.isFinite(n)) return '— €';
  const abs = Math.abs(Math.round(n));
  if (lang === 'en') return `€${abs.toLocaleString('en-US')}`;
  const grouped = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' '); // thin space
  return `${grouped} €`;
}

/** `1,2 M €` for summaries. */
export function formatEurShort(n: number, lang: Lang = 'lv'): string {
  if (n >= 1_000_000) {
    const m = (n / 1_000_000).toFixed(1).replace(/\.0$/, '');
    return lang === 'en' ? `€${m}M` : `${m.replace('.', ',')} M €`;
  }
  return formatEur(n, lang);
}

export function formatPercent(err: number, lang: Lang = 'lv'): string {
  const p = Math.round(err * 100);
  return lang === 'en' ? `${p}%` : `${p} %`;
}

/** Quick +/- steps per category (docs/02 §1.2). */
export const QUICK_STEPS: Record<Category | 'all', [number, number]> = {
  flats: [1000, 10000],
  houses: [1000, 10000],
  land: [1000, 5000],
  cars: [100, 500],
  random: [1, 10],
  all: [100, 1000],
};

export const MAX_DIGITS: Record<Category | 'all', number> = {
  flats: 7, houses: 7, land: 7, cars: 6, random: 5, all: 7,
};

export function formatKm(km: number): string {
  return `${km.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} km`;
}
