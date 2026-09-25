/**
 * Scoring (docs/02-game-design.md §2). Mirrors public.score() in Postgres;
 * the server is authoritative, this is for previews, offline packs and tests.
 */
export const SCORE_K = 8;
export const MAX_ROUND_SCORE = 1000;

export function relativeError(guess: number, price: number): number {
  if (price <= 0) return 1;
  return Math.abs(guess - price) / price;
}

export function score(guess: number, price: number, k = SCORE_K): number {
  if (!Number.isFinite(guess) || guess <= 0 || price <= 0) return 0;
  return Math.round(MAX_ROUND_SCORE * Math.exp(-k * relativeError(guess, price)));
}

export type GridCell = '🟩' | '🟨' | '🟥';

/** Green within 10 %, yellow within 25 %, red otherwise. Mirrors public.grid_cell(). */
export function gridCell(guess: number, price: number): GridCell {
  const e = relativeError(guess, price);
  if (e <= 0.10) return '🟩';
  if (e <= 0.25) return '🟨';
  return '🟥';
}

/** Streak mode: survive if within 15 %. */
export const STREAK_TOLERANCE = 0.15;
export const streakSurvives = (guess: number, price: number) => relativeError(guess, price) <= STREAK_TOLERANCE;

export function shareText(number: number, total: number, grid: string, locale: 'lv' | 'ru' | 'en' = 'lv'): string {
  const title = locale === 'en' ? 'Guess the Price' : 'Uzmini Cenu';
  const totalStr = total.toLocaleString(locale === 'en' ? 'en-US' : 'lv-LV').replace(/ /g, ' ');
  return `${title} #${number}  ${totalStr} / 5 000\n${grid}\nhttps://uzminicenu.lv/d/${number}`;
}
