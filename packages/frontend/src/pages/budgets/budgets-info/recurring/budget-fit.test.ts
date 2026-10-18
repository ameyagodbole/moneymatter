import type { BudgetPeriodTotals } from '@/api/budgets';
import { describe, expect, it } from 'vitest';

import { computeBudgetFit, roundUpToNiceLimit } from './budget-fit';

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

describe('computeBudgetFit', () => {
  it('reports how far over or under each finished period was', () => {
    const fit = computeBudgetFit({
      periods: [period({ month: 7, spent: 590 }), period({ month: 8, spent: 400 }), period({ month: 9, spent: 500 })],
      now,
    });

    expect(fit.periods.map((p) => [p.difference, p.ratio])).toEqual([
      [90, 0.18],
      [-100, -0.2],
      [0, 0],
    ]);
    expect(fit.overCount).toBe(1);
  });

  it('leaves out the current period and periods without a limit', () => {
    const fit = computeBudgetFit({
      periods: [period({ month: 9, spent: 100, limit: null }), period({ month: 10, spent: 900 })],
      now,
    });

    expect(fit.periods).toEqual([]);
    expect(fit.verdict).toBe('insufficient');
  });

  it('needs three finished periods for a verdict', () => {
    const fit = computeBudgetFit({
      periods: [period({ month: 8, spent: 900 }), period({ month: 9, spent: 900 })],
      now,
    });

    expect(fit.verdict).toBe('insufficient');
    expect(fit.suggestedLimit).toBeNull();
  });

  it('calls a limit too tight when it is overspent more often than not, and suggests one that covers 80%', () => {
    const fit = computeBudgetFit({
      periods: [
        period({ month: 5, spent: 610 }),
        period({ month: 6, spent: 480 }),
        period({ month: 7, spent: 655 }),
        period({ month: 8, spent: 590 }),
        period({ month: 9, spent: 702 }),
      ],
      now,
    });

    expect(fit.verdict).toBe('tooTight');
    expect(fit.overCount).toBe(4);
    // 80th percentile of [480, 590, 610, 655, 702] is 655 → 660.
    expect(fit.suggestedLimit).toBe(660);
  });

  it('calls a limit roomy when it is never reached and mostly unused', () => {
    const fit = computeBudgetFit({
      periods: [period({ month: 7, spent: 250 }), period({ month: 8, spent: 300 }), period({ month: 9, spent: 280 })],
      now,
    });

    expect(fit.verdict).toBe('roomy');
    expect(fit.averageUsage).toBeCloseTo(0.553, 2);
    expect(fit.suggestedLimit).toBe(300);
  });

  it('calls a limit realistic otherwise, without a suggestion', () => {
    const fit = computeBudgetFit({
      periods: [period({ month: 7, spent: 520 }), period({ month: 8, spent: 430 }), period({ month: 9, spent: 470 })],
      now,
    });

    expect(fit.verdict).toBe('realistic');
    expect(fit.suggestedLimit).toBeNull();
  });
});

describe('roundUpToNiceLimit', () => {
  it('rounds up to a tidy step for the size of the amount', () => {
    expect(roundUpToNiceLimit({ amount: 437 })).toBe(440);
    expect(roundUpToNiceLimit({ amount: 1234 })).toBe(1300);
    expect(roundUpToNiceLimit({ amount: 87 })).toBe(87);
    expect(roundUpToNiceLimit({ amount: 300 })).toBe(300);
    expect(roundUpToNiceLimit({ amount: 0 })).toBe(0);
  });
});
