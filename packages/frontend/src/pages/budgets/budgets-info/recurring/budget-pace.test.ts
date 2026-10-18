import { describe, expect, it } from 'vitest';

import { computeBudgetPace } from './budget-pace';

// Local time, so day counting doesn't depend on the test runner's timezone.
const period = { periodStart: new Date(2026, 9, 1), periodEnd: new Date(2026, 9, 31, 23, 59, 59, 999) };
const midMonth = new Date(2026, 9, 16, 12);

describe('computeBudgetPace', () => {
  it('compares spending with an even pace through the period', () => {
    const pace = computeBudgetPace({ ...period, spent: 300, limit: 500, now: midMonth })!;

    expect(pace.elapsedRatio).toBeCloseTo(0.5, 1);
    expect(pace.expectedSpent).toBeCloseTo(250, -1);
    expect(pace.paceDelta).toBeGreaterThan(0);
    expect(pace.projectedSpent).toBeCloseTo(600, -1);
  });

  it('spreads what is left over the remaining days, today included', () => {
    const pace = computeBudgetPace({ ...period, spent: 200, limit: 500, now: midMonth })!;

    expect(pace.daysLeft).toBe(16);
    expect(pace.dailyAllowance).toBeCloseTo(300 / 16, 5);
  });

  it('has no allowance left once the limit is used up', () => {
    expect(computeBudgetPace({ ...period, spent: 700, limit: 500, now: midMonth })!.dailyAllowance).toBe(0);
  });

  it('is null without a positive limit or outside the period', () => {
    expect(computeBudgetPace({ ...period, spent: 100, limit: null, now: midMonth })).toBeNull();
    expect(computeBudgetPace({ ...period, spent: 100, limit: 0, now: midMonth })).toBeNull();
    expect(computeBudgetPace({ ...period, spent: 100, limit: 500, now: new Date(2026, 10, 2) })).toBeNull();
  });
});
