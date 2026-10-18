import { describe, expect, it } from 'vitest';

import { pickAxisTicks } from './pick-axis-ticks';

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe('pickAxisTicks', () => {
  it('keeps every tick when they fit', () => {
    expect(pickAxisTicks({ values: range(12), width: 700 })).toEqual(range(12));
  });

  it('thins a crowded axis to what fits, keeping the first and last', () => {
    const ticks = pickAxisTicks({ values: range(31), width: 560, minSpacing: 56 });

    expect(ticks[0]).toBe(1);
    expect(ticks[ticks.length - 1]).toBe(31);
    expect(ticks.length).toBeLessThanOrEqual(10);
    expect(ticks).toEqual([1, 5, 9, 13, 17, 21, 25, 31]);
  });

  it('always shows at least the ends on a very narrow axis', () => {
    expect(pickAxisTicks({ values: range(31), width: 40 })).toEqual([1, 31]);
  });
});
