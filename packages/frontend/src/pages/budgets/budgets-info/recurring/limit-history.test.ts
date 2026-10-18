import type { BudgetPeriodTotals } from '@/api/budgets';
import { describe, expect, it } from 'vitest';

import { computeLimitHistory } from './limit-history';

const now = new Date('2026-10-17T12:00:00.000Z');

/** Monthly periods of 2026, January = index 0. */
const period = ({
  month,
  spent,
  limit = 500,
}: {
  month: number;
  spent: number;
  limit?: number | null;
}): BudgetPeriodTotals => ({
  index: month - 1,
  periodStart: new Date(Date.UTC(2026, month - 1, 1)).toISOString(),
  periodEnd: new Date(Date.UTC(2026, month, 1) - 1).toISOString(),
  expense: spent,
  income: 0,
  spent,
  limitAmount: limit,
  utilizationRate: limit ? (spent / limit) * 100 : null,
});

describe('computeLimitHistory', () => {
  it('counts finished periods within the limit and averages their use of it', () => {
    const history = computeLimitHistory({
      periods: [period({ month: 7, spent: 590 }), period({ month: 8, spent: 400 }), period({ month: 9, spent: 500 })],
      now,
    });

    expect(history).toEqual({ periodsCount: 3, withinCount: 2, averageUsage: (1.18 + 0.8 + 1) / 3 });
  });

  it('leaves out the current period and periods without a limit', () => {
    const history = computeLimitHistory({
      periods: [period({ month: 9, spent: 100, limit: null }), period({ month: 10, spent: 900 })],
      now,
    });

    expect(history).toEqual({ periodsCount: 0, withinCount: 0, averageUsage: null });
  });
});
