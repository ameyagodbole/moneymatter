import { describe, expect, it } from '@jest/globals';

import { toCurrentShareBasis } from './share-basis';

const TSLA_3_FOR_1 = { date: '2022-08-25', numerator: '3', denominator: '1' };

describe('toCurrentShareBasis', () => {
  it('multiplies a quantity by every split dated after the trade', () => {
    expect(toCurrentShareBasis({ quantity: '0.08124', date: '2021-11-10', splits: [TSLA_3_FOR_1] }).toString()).toBe(
      '0.24372',
    );
  });

  it('leaves a trade on or after the ex-date unchanged', () => {
    expect(toCurrentShareBasis({ quantity: '2', date: '2022-08-25', splits: [TSLA_3_FOR_1] }).toString()).toBe('2');
    expect(toCurrentShareBasis({ quantity: '2', date: '2026-01-01', splits: [TSLA_3_FOR_1] }).toString()).toBe('2');
  });

  it('compounds consecutive splits and handles reverse splits', () => {
    const splits = [
      { date: '2021-07-20', numerator: '4', denominator: '1' },
      { date: '2024-06-10', numerator: '10', denominator: '1' },
      { date: '2025-01-01', numerator: '1', denominator: '5' },
    ];
    expect(toCurrentShareBasis({ quantity: '1', date: '2021-01-01', splits }).toString()).toBe('8');
    expect(toCurrentShareBasis({ quantity: '1', date: '2022-01-01', splits }).toString()).toBe('2');
  });
});
