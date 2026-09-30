import { describe, expect, it } from 'vitest';

import { normalizeTolerance } from './normalize-tolerance';

const range = { min: 1, max: 60, fallback: 14 };

describe('normalizeTolerance', () => {
  it('keeps a value inside the range', () => {
    expect(normalizeTolerance({ value: 7, ...range })).toBe(7);
    expect(normalizeTolerance({ value: '2.5', ...range })).toBe(2.5);
  });

  it('falls back to the default for empty or non-numeric input', () => {
    expect(normalizeTolerance({ value: '', ...range })).toBe(14);
    expect(normalizeTolerance({ value: null, ...range })).toBe(14);
    expect(normalizeTolerance({ value: undefined, ...range })).toBe(14);
    expect(normalizeTolerance({ value: 'abc', ...range })).toBe(14);
  });

  it('clamps values outside the range', () => {
    expect(normalizeTolerance({ value: 0, ...range })).toBe(1);
    expect(normalizeTolerance({ value: -5, ...range })).toBe(1);
    expect(normalizeTolerance({ value: 90, ...range })).toBe(60);
  });

  it('rounds to a whole number when integer is set', () => {
    expect(normalizeTolerance({ value: 2.6, ...range, integer: true })).toBe(3);
    expect(normalizeTolerance({ value: '0.2', ...range, integer: true })).toBe(1);
  });

  it('allows zero when it is the minimum', () => {
    expect(normalizeTolerance({ value: 0, min: 0, max: 50, fallback: 10 })).toBe(0);
  });
});
