/**
 * Plural forms of the count strings owned by the game screens (practice.*,
 * summary.*, daily.*), resolved through the real src/i18n resources:
 *  - lv: n%10==1 && n%100!=11 → singular ("punktu" / "punkts" / "diena"),
 *        CLDR "zero" (0, 10–20, 30…) and "other" share the plural form
 *  - ru: one / few / many (очко / очка / очков, день / дня / дней)
 *  - en: one / other
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'lv' }] }));

import i18n from '../i18n';

const tl = (lng: 'lv' | 'ru' | 'en') => i18n.getFixedT(lng, 'common');

describe('practice.started_with', () => {
  it('lv', () => {
    const t = tl('lv');
    expect(t('practice.started_with', { count: 1 })).toBe('Tu sāki ar 1 punktu');
    expect(t('practice.started_with', { count: 21 })).toBe('Tu sāki ar 21 punktu');
    expect(t('practice.started_with', { count: 101 })).toBe('Tu sāki ar 101 punktu');
    expect(t('practice.started_with', { count: 0 })).toBe('Tu sāki ar 0 punktiem');
    expect(t('practice.started_with', { count: 2 })).toBe('Tu sāki ar 2 punktiem');
    expect(t('practice.started_with', { count: 11 })).toBe('Tu sāki ar 11 punktiem');
    expect(t('practice.started_with', { count: 20 })).toBe('Tu sāki ar 20 punktiem');
    expect(t('practice.started_with', { count: 111 })).toBe('Tu sāki ar 111 punktiem');
    expect(t('practice.started_with', { count: 1534 })).toBe('Tu sāki ar 1534 punktiem');
  });
  it('ru', () => {
    const t = tl('ru');
    expect(t('practice.started_with', { count: 1 })).toBe('Ты начал с 1 очка');
    expect(t('practice.started_with', { count: 21 })).toBe('Ты начал с 21 очка');
    expect(t('practice.started_with', { count: 2 })).toBe('Ты начал с 2 очков');
    expect(t('practice.started_with', { count: 5 })).toBe('Ты начал с 5 очков');
    expect(t('practice.started_with', { count: 11 })).toBe('Ты начал с 11 очков');
    expect(t('practice.started_with', { count: 0 })).toBe('Ты начал с 0 очков');
  });
  it('en', () => {
    const t = tl('en');
    expect(t('practice.started_with', { count: 1 })).toBe('You started with 1 point');
    expect(t('practice.started_with', { count: 0 })).toBe('You started with 0 points');
    expect(t('practice.started_with', { count: 2 })).toBe('You started with 2 points');
  });
});

describe('summary.avg', () => {
  it('lv / ru / en', () => {
    expect(tl('lv')('summary.avg', { count: 1 })).toBe('Vidēji 1 punkts kārtā');
    expect(tl('lv')('summary.avg', { count: 0 })).toBe('Vidēji 0 punkti kārtā');
    expect(tl('lv')('summary.avg', { count: 10 })).toBe('Vidēji 10 punkti kārtā');
    expect(tl('lv')('summary.avg', { count: 512 })).toBe('Vidēji 512 punkti kārtā');
    expect(tl('ru')('summary.avg', { count: 1 })).toBe('В среднем 1 очко за раунд');
    expect(tl('ru')('summary.avg', { count: 3 })).toBe('В среднем 3 очка за раунд');
    expect(tl('ru')('summary.avg', { count: 512 })).toBe('В среднем 512 очков за раунд');
    expect(tl('en')('summary.avg', { count: 1 })).toBe('Average 1 point per round');
    expect(tl('en')('summary.avg', { count: 512 })).toBe('Average 512 points per round');
  });
});

describe('daily.streak_days', () => {
  it('lv / ru / en', () => {
    expect(tl('lv')('daily.streak_days', { count: 2 })).toBe('2 dienas pēc kārtas');
    expect(tl('lv')('daily.streak_days', { count: 21 })).toBe('21 diena pēc kārtas');
    expect(tl('lv')('daily.streak_days', { count: 10 })).toBe('10 dienas pēc kārtas');
    expect(tl('ru')('daily.streak_days', { count: 2 })).toBe('2 дня подряд');
    expect(tl('ru')('daily.streak_days', { count: 5 })).toBe('5 дней подряд');
    expect(tl('ru')('daily.streak_days', { count: 21 })).toBe('21 день подряд');
    expect(tl('en')('daily.streak_days', { count: 2 })).toBe('2 days in a row');
    expect(tl('en')('daily.streak_days', { count: 1 })).toBe('1 day in a row');
  });
});
