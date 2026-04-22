// Unit normalization tests.

import { describe, it, expect } from 'vitest';
import {
  dimensionOf,
  toBase,
  fromBase,
  sumCompatible,
  scaleQty,
  formatQty,
} from '../../src/unit-normalize.js';

describe('dimensionOf', () => {
  it('classifies volume units', () => {
    expect(dimensionOf('cup')).toBe('volume');
    expect(dimensionOf('tbsp')).toBe('volume');
    expect(dimensionOf('ml')).toBe('volume');
  });
  it('classifies weight units', () => {
    expect(dimensionOf('g')).toBe('weight');
    expect(dimensionOf('lb')).toBe('weight');
    expect(dimensionOf('oz')).toBe('weight');
  });
  it('classifies opaque units', () => {
    expect(dimensionOf('clove')).toBe('opaque');
    expect(dimensionOf('pinch')).toBe('opaque');
  });
  it('returns count for unknown unit', () => {
    expect(dimensionOf(null)).toBe('count');
    expect(dimensionOf('')).toBe('count');
    expect(dimensionOf('widget')).toBe('count');
  });
});

describe('toBase / fromBase round-trip', () => {
  it('converts tbsp -> tsp', () => {
    expect(toBase(1, 'tbsp')).toBe(3);
  });
  it('converts cup -> tsp', () => {
    expect(toBase(1, 'cup')).toBe(48);
  });
  it('preserves volume through base', () => {
    const back = fromBase(toBase(2, 'cup'), 'volume');
    expect(back.unit).toBe('cup');
    expect(back.qty).toBeCloseTo(2);
  });
  it('prefers lb for large weights', () => {
    const back = fromBase(toBase(2, 'lb'), 'weight');
    expect(back.unit).toBe('lb');
    expect(back.qty).toBeCloseTo(2);
  });
  it('prefers oz for mid weights', () => {
    const back = fromBase(toBase(4, 'oz'), 'weight');
    expect(back.unit).toBe('oz');
    expect(back.qty).toBeCloseTo(4);
  });
});

describe('sumCompatible', () => {
  it('sums two tbsp', () => {
    const r = sumCompatible([{ qty: 1, unit: 'tbsp' }, { qty: 2, unit: 'tbsp' }]);
    expect(r.unit).toBe('tbsp');
    expect(r.qty).toBeCloseTo(3);
  });
  it('combines tbsp + cup via base', () => {
    // 2 tbsp + 1 cup = 6 tsp + 48 tsp = 54 tsp = 1.125 cup
    const r = sumCompatible([{ qty: 2, unit: 'tbsp' }, { qty: 1, unit: 'cup' }]);
    expect(r.unit).toBe('cup');
    expect(r.qty).toBeCloseTo(1.125);
  });
  it('refuses to mix volume and weight', () => {
    expect(sumCompatible([{ qty: 1, unit: 'cup' }, { qty: 1, unit: 'g' }])).toBeNull();
  });
  it('combines opaque only when unit matches', () => {
    const r = sumCompatible([{ qty: 2, unit: 'clove' }, { qty: 3, unit: 'clove' }]);
    expect(r.unit).toBe('clove');
    expect(r.qty).toBe(5);
    expect(sumCompatible([{ qty: 1, unit: 'clove' }, { qty: 1, unit: 'pinch' }])).toBeNull();
  });
});

describe('scaleQty', () => {
  it('doubles a quantity', () => {
    expect(scaleQty(1.5, 2)).toBe(3);
  });
  it('passes through null safely', () => {
    expect(scaleQty(null, 2)).toBeNull();
  });
});

describe('formatQty', () => {
  it('renders integers cleanly', () => {
    expect(formatQty(2)).toBe('2');
  });
  it('snaps to common fractions', () => {
    expect(formatQty(0.5)).toBe('1/2');
    expect(formatQty(0.25)).toBe('1/4');
    expect(formatQty(1.5)).toBe('1 1/2');
    expect(formatQty(2 / 3)).toBe('2/3');
  });
  it('falls back to decimals when no fraction fits', () => {
    expect(formatQty(1.17)).toBe('1.17');
  });
  it('handles zero and null', () => {
    expect(formatQty(0)).toBe('0');
    expect(formatQty(null)).toBe('');
  });
});
