import { BUDGET_ROLLOVERS } from '@bt/shared/types';

import { computeEffectiveLimits, sumEntriesByPeriod } from './period-totals';

const periods = [
  { index: 0, start: new Date('2026-01-01T00:00:00.000Z'), end: new Date('2026-01-31T23:59:59.999Z') },
  { index: 1, start: new Date('2026-02-01T00:00:00.000Z'), end: new Date('2026-02-28T23:59:59.999Z') },
];

const entry = (iso: string, cents: number, isExpense = true) => ({
  transactionId: iso,
  splitId: null,
  time: new Date(iso),
  cents,
  isExpense,
  categoryId: null,
  source: 'rule' as const,
});

describe('sumEntriesByPeriod', () => {
  it('buckets entries and refunds into their periods', () => {
    const totals = sumEntriesByPeriod({
      periods,
      entries: [
        entry('2026-01-10T00:00:00Z', 5_000),
        entry('2026-02-03T00:00:00Z', 2_000),
        entry('2026-02-04T00:00:00Z', 300, false),
      ],
      refundAdjustments: [{ time: new Date('2026-01-12T00:00:00Z'), cents: 1_000, isExpense: true, categoryId: null }],
    });

    expect(totals).toEqual([
      { expense: 4_000, income: 0 },
      { expense: 2_000, income: 300 },
    ]);
  });

  it('ignores entries outside every period', () => {
    const totals = sumEntriesByPeriod({
      periods,
      entries: [
        {
          transactionId: 'x',
          splitId: null,
          time: new Date('2025-12-31T12:00:00Z'),
          cents: 999,
          isExpense: true,
          categoryId: null,
          source: 'rule',
        },
      ],
      refundAdjustments: [],
    });

    expect(totals).toEqual([
      { expense: 0, income: 0 },
      { expense: 0, income: 0 },
    ]);
  });
});

describe('computeEffectiveLimits', () => {
  const spentByPeriod = [300, 700, 400];

  it('keeps the base limit without rollover', () => {
    expect(computeEffectiveLimits({ baseLimit: 500, rollover: BUDGET_ROLLOVERS.none, spentByPeriod })).toEqual([
      { limit: 500, carriedIn: 0 },
      { limit: 500, carriedIn: 0 },
      { limit: 500, carriedIn: 0 },
    ]);
  });

  it('carries only unspent limit forward with surplus', () => {
    // 500 - 300 = 200 carried; 700 - 700 = 0 carried.
    expect(computeEffectiveLimits({ baseLimit: 500, rollover: BUDGET_ROLLOVERS.surplus, spentByPeriod })).toEqual([
      { limit: 500, carriedIn: 0 },
      { limit: 700, carriedIn: 200 },
      { limit: 500, carriedIn: 0 },
    ]);
  });

  it('carries overspending too with all', () => {
    // 500 - 300 = +200; 700 - 700 = 0; then a 900 overspend would carry -400.
    expect(
      computeEffectiveLimits({ baseLimit: 500, rollover: BUDGET_ROLLOVERS.all, spentByPeriod: [300, 700, 900, 0] }),
    ).toEqual([
      { limit: 500, carriedIn: 0 },
      { limit: 700, carriedIn: 200 },
      { limit: 500, carriedIn: 0 },
      { limit: 100, carriedIn: -400 },
    ]);
  });
});
