import { describe, expect, it } from 'vitest';
import {
  canSubmit, canTripleZero, clampValue, derivedValue, digitCount, keypadReduce, maxValueFor, quickStepsFor, stepLabel,
} from './keypad';

describe('keypadReduce', () => {
  it('appends digits and drops leading zeros', () => {
    let v = 0;
    v = keypadReduce(v, { type: 'digit', digit: 0 }, 'flats');
    expect(v).toBe(0);
    v = keypadReduce(v, { type: 'digit', digit: 7 }, 'flats');
    v = keypadReduce(v, { type: 'digit', digit: 8 }, 'flats');
    expect(v).toBe(78);
  });

  it('respects max digits per category', () => {
    let v = 99999; // 5 digits, random max is 5
    v = keypadReduce(v, { type: 'digit', digit: 1 }, 'random');
    expect(v).toBe(99999);
    v = keypadReduce(999999, { type: 'digit', digit: 1 }, 'cars'); // 6 digits max
    expect(v).toBe(999999);
    v = keypadReduce(999999, { type: 'digit', digit: 1 }, 'flats'); // 7 digits max
    expect(v).toBe(9999991);
  });

  it('000 appends three zeros only when it fits and value is non-empty', () => {
    expect(keypadReduce(0, { type: 'triple_zero' }, 'flats')).toBe(0);
    expect(keypadReduce(78, { type: 'triple_zero' }, 'flats')).toBe(78000);
    expect(canTripleZero(78500, 'flats')).toBe(false); // 5 + 3 > 7
    expect(keypadReduce(78500, { type: 'triple_zero' }, 'flats')).toBe(78500);
  });

  it('backspace removes the last digit, clear empties', () => {
    expect(keypadReduce(785, { type: 'backspace' }, 'flats')).toBe(78);
    expect(keypadReduce(7, { type: 'backspace' }, 'flats')).toBe(0);
    expect(keypadReduce(0, { type: 'backspace' }, 'flats')).toBe(0);
    expect(keypadReduce(78500, { type: 'clear' }, 'flats')).toBe(0);
  });

  it('quick steps add/subtract and clamp to [0, 10^max - 1]', () => {
    expect(keypadReduce(0, { type: 'step', delta: 1000 }, 'flats')).toBe(1000);
    expect(keypadReduce(500, { type: 'step', delta: -1000 }, 'flats')).toBe(0);
    expect(keypadReduce(maxValueFor('cars'), { type: 'step', delta: 500 }, 'cars')).toBe(999999);
    expect(clampValue(-5, 'random')).toBe(0);
  });

  it('exposes category step sets in display order', () => {
    expect(quickStepsFor('flats')).toEqual([-10000, -1000, 1000, 10000]);
    expect(quickStepsFor('cars')).toEqual([-500, -100, 100, 500]);
    expect(quickStepsFor('random')).toEqual([-10, -1, 1, 10]);
  });

  it('labels steps compactly', () => {
    expect(stepLabel(10000)).toBe('+10k');
    expect(stepLabel(-1000)).toBe('−1k');
    expect(stepLabel(500)).toBe('+500');
  });

  it('submit is enabled from 1 EUR', () => {
    expect(canSubmit(0)).toBe(false);
    expect(canSubmit(1)).toBe(true);
    expect(digitCount(0)).toBe(0);
    expect(digitCount(1000)).toBe(4);
  });

  it('derives €/m² for flats and nothing for cars', () => {
    expect(derivedValue(78500, 'flats', { m2: 65 })).toEqual({ kind: 'per_m2', value: 1208 });
    expect(derivedValue(4200, 'cars', { km: 200000 })).toBeNull();
    expect(derivedValue(0, 'flats', { m2: 65 })).toBeNull();
    expect(derivedValue(50000, 'land', { land_m2: 5000 })).toEqual({ kind: 'per_ha', value: 100000 });
  });
});
