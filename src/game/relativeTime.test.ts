import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'lv' }] }));

import i18n from '../i18n';
import { dayDiff, relativeDay } from './relativeTime';

const tr = (lng: 'lv' | 'ru' | 'en') => i18n.getFixedT(lng, 'review');
// 2026-10-17 14:00 in Riga (UTC+3 in October before DST ends on the 25th).
const now = new Date('2026-10-17T11:00:00Z');

describe('dayDiff', () => {
  it('counts Riga calendar days, not 24 h windows', () => {
    expect(dayDiff('2026-10-17T00:30:00+03:00', now)).toBe(0);
    // 23:50 Riga the previous evening is "yesterday" even though < 24 h ago.
    expect(dayDiff('2026-10-16T23:50:00+03:00', now)).toBe(1);
    expect(dayDiff('2026-10-14T12:00:00Z', now)).toBe(3);
    // Future timestamps (clock skew) are not negative-days-ago.
    expect(dayDiff('2026-10-18T12:00:00Z', now)).toBe(-1);
    expect(Number.isNaN(dayDiff('not a date', now))).toBe(true);
  });
});

describe('relativeDay', () => {
  it('lv', () => {
    const t = tr('lv');
    expect(relativeDay('2026-10-17T05:00:00Z', t, now)).toBe('šodien');
    expect(relativeDay('2026-10-16T05:00:00Z', t, now)).toBe('vakar');
    expect(relativeDay('2026-10-14T05:00:00Z', t, now)).toBe('pirms 3 dienām');
    expect(relativeDay('2026-10-07T05:00:00Z', t, now)).toBe('pirms 10 dienām');
    expect(relativeDay('2026-09-26T05:00:00Z', t, now)).toBe('pirms 21 dienas');
  });
  it('ru', () => {
    const t = tr('ru');
    expect(relativeDay('2026-10-17T05:00:00Z', t, now)).toBe('сегодня');
    expect(relativeDay('2026-10-16T05:00:00Z', t, now)).toBe('вчера');
    expect(relativeDay('2026-10-15T05:00:00Z', t, now)).toBe('2 дня назад');
    expect(relativeDay('2026-10-12T05:00:00Z', t, now)).toBe('5 дней назад');
    expect(relativeDay('2026-09-26T05:00:00Z', t, now)).toBe('21 день назад');
  });
  it('en', () => {
    const t = tr('en');
    expect(relativeDay('2026-10-17T05:00:00Z', t, now)).toBe('today');
    expect(relativeDay('2026-10-16T05:00:00Z', t, now)).toBe('yesterday');
    expect(relativeDay('2026-10-14T05:00:00Z', t, now)).toBe('3 days ago');
  });
  it('clamps future timestamps to today and tolerates garbage', () => {
    expect(relativeDay('2026-10-19T05:00:00Z', tr('en'), now)).toBe('today');
    expect(relativeDay('garbage', tr('en'), now)).toBe('');
  });
});
