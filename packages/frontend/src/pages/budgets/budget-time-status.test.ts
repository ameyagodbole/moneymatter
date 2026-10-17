import { BUDGET_RECURRENCES } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { getBudgetTimeStatus } from './budget-time-status';

const now = new Date('2026-10-17T12:00:00.000Z');
const date = (iso: string) => new Date(iso);

describe('getBudgetTimeStatus', () => {
  describe('one-off budgets', () => {
    const oneOff = { recurrence: BUDGET_RECURRENCES.none };

    it('is null without dates', () => {
      expect(getBudgetTimeStatus({ budget: oneOff, now })).toBeNull();
    });

    it('counts the days left inside the range', () => {
      const budget = { ...oneOff, startDate: date('2026-10-01T00:00:00Z'), endDate: date('2026-10-27T12:00:00Z') };
      expect(getBudgetTimeStatus({ budget, now })).toEqual({ status: 'active', daysLeft: 10 });
    });

    it('is upcoming before the start and ended after the end', () => {
      expect(getBudgetTimeStatus({ budget: { ...oneOff, startDate: date('2026-10-20T12:00:00Z') }, now })).toEqual({
        status: 'upcoming',
        daysUntil: 3,
      });
      expect(getBudgetTimeStatus({ budget: { ...oneOff, endDate: date('2026-10-01T00:00:00Z') }, now })).toEqual({
        status: 'ended',
      });
    });
  });

  describe('recurring budgets', () => {
    const monthly = { recurrence: BUDGET_RECURRENCES.monthly, startDate: date('2026-01-01T00:00:00Z') };
    const period = { index: 9, start: '2026-10-01T00:00:00.000Z', end: '2026-10-31T23:59:59.999Z' };

    it('counts the days left in the current period, not in the series', () => {
      expect(getBudgetTimeStatus({ budget: monthly, period, now })).toEqual({ status: 'active', daysLeft: 14 });
    });

    it('is null until the period has loaded', () => {
      expect(getBudgetTimeStatus({ budget: monthly, period: null, now })).toBeNull();
    });

    it('is ended once the series end has passed, and upcoming before it starts', () => {
      expect(
        getBudgetTimeStatus({ budget: { ...monthly, endDate: date('2026-06-30T23:59:59Z') }, period, now }),
      ).toEqual({ status: 'ended' });
      expect(
        getBudgetTimeStatus({ budget: { ...monthly, startDate: date('2026-11-01T00:00:00Z') }, period, now }),
      ).toEqual({ status: 'upcoming', daysUntil: 14 });
    });
  });
});
