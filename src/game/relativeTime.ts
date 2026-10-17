/**
 * "today" / "yesterday" / "N days ago" for the listing-availability line of
 * the session review. Days are counted on the Europe/Riga calendar (the same
 * day boundary the daily uses), so a check at 23:50 shown at 00:10 reads
 * "yesterday", not "today".
 */
import { rigaDay } from './time';

type T = (key: string, opts?: Record<string, unknown>) => string;

const dayToUtc = (day: string): number => {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

/** Whole Riga calendar days between `iso` and `now` (0 = same day). Negative when `iso` is in the future. NaN for an unparsable date. */
export function dayDiff(iso: string, now: Date = new Date()): number {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return NaN;
  return Math.round((dayToUtc(rigaDay(now)) - dayToUtc(rigaDay(then))) / 86_400_000);
}

/**
 * Relative day label resolved through the `review` namespace:
 * `review:today`, `review:yesterday`, `review:days_ago` (count plurals).
 * `t` must be bound to the `review` namespace (e.g. `useTranslation('review').t`
 * or `i18n.getFixedT(lng, 'review')`). Returns '' for an unparsable date.
 */
export function relativeDay(iso: string, t: T, now: Date = new Date()): string {
  const diff = dayDiff(iso, now);
  if (Number.isNaN(diff)) return '';
  if (diff <= 0) return t('today');
  if (diff === 1) return t('yesterday');
  return t('days_ago', { count: diff });
}
