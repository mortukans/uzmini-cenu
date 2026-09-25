/**
 * Europe/Riga day boundary helpers (docs/02 §3.3). Uses Intl for the TZ math so
 * DST comes from the tz database, never a hard-coded +2/+3.
 */
export const RIGA_TZ = 'Europe/Riga';

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: RIGA_TZ,
  hour12: false,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

interface WallClock { y: number; m: number; d: number; h: number; min: number; s: number }

export function rigaWallClock(now: Date = new Date()): WallClock {
  const p: Record<string, number> = {};
  for (const part of partsFmt.formatToParts(now)) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  // Intl may report midnight as 24 with hour12:false in some engines.
  const h = p.hour === 24 ? 0 : p.hour;
  return { y: p.year, m: p.month, d: p.day, h, min: p.minute, s: p.second };
}

/** `YYYY-MM-DD` of today in Riga. */
export function rigaDay(now: Date = new Date()): string {
  const { y, m, d } = rigaWallClock(now);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Seconds until the next 00:00 in Riga. */
export function secondsUntilRigaMidnight(now: Date = new Date()): number {
  const { h, min, s } = rigaWallClock(now);
  const elapsed = h * 3600 + min * 60 + s;
  return Math.max(1, 86_400 - elapsed);
}

/** `hh:mm:ss` */
export function formatCountdown(totalSeconds: number): string {
  const t = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

/** dd.mm.yyyy (lv/ru) or d MMM yyyy (en) for a `YYYY-MM-DD` day string. */
export function formatDay(day: string, lang: 'lv' | 'ru' | 'en'): string {
  const [y, m, d] = day.split('-').map(Number);
  if (lang === 'en') {
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`;
}
