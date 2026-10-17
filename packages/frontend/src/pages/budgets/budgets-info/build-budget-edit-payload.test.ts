import { BUDGET_RECURRENCES } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { buildBudgetEditPayload } from './build-budget-edit-payload';

describe('buildBudgetEditPayload', () => {
  const baseValues = { name: 'Groceries', categoryIds: ['cat-1', 'cat-2'] };

  it('omits limitAmount when it is null', () => {
    const payload = buildBudgetEditPayload({ ...baseValues, limitAmount: null });

    expect(payload).toEqual({ name: 'Groceries', categoryIds: ['cat-1', 'cat-2'] });
    expect('limitAmount' in payload).toBe(false);
  });

  it('omits limitAmount when it is undefined', () => {
    const payload = buildBudgetEditPayload({ ...baseValues, limitAmount: undefined });

    expect('limitAmount' in payload).toBe(false);
  });

  it('omits limitAmount when it is 0', () => {
    const payload = buildBudgetEditPayload({ ...baseValues, limitAmount: 0 });

    expect('limitAmount' in payload).toBe(false);
  });

  it('omits limitAmount when it is negative', () => {
    const payload = buildBudgetEditPayload({ ...baseValues, limitAmount: -50 });

    expect('limitAmount' in payload).toBe(false);
  });

  it('includes limitAmount when it is a positive number', () => {
    const payload = buildBudgetEditPayload({ ...baseValues, limitAmount: 250 });

    expect(payload).toEqual({ name: 'Groceries', categoryIds: ['cat-1', 'cat-2'], limitAmount: 250 });
  });

  it('omits categoryIds when the form has none (manual budgets)', () => {
    const payload = buildBudgetEditPayload({ name: 'Household', limitAmount: null });

    expect(payload).toEqual({ name: 'Household' });
  });

  describe('schedule', () => {
    const startDate = new Date('2026-01-25T00:00:00.000Z');

    it('sends recurrence, timezone and dates for a recurring budget', () => {
      const payload = buildBudgetEditPayload({
        ...baseValues,
        limitAmount: null,
        schedule: { recurrence: BUDGET_RECURRENCES.monthly, startDate, endDate: null },
        timezone: 'Europe/Kyiv',
      });

      expect(payload).toEqual({
        ...baseValues,
        recurrence: BUDGET_RECURRENCES.monthly,
        timezone: 'Europe/Kyiv',
        startDate: '2026-01-25T00:00:00.000Z',
        endDate: null,
      });
    });

    it('sends only the recurrence when a budget stops repeating', () => {
      const payload = buildBudgetEditPayload({
        ...baseValues,
        limitAmount: null,
        schedule: { recurrence: BUDGET_RECURRENCES.none, startDate, endDate: null },
        timezone: 'Europe/Kyiv',
      });

      expect(payload).toEqual({ ...baseValues, recurrence: BUDGET_RECURRENCES.none, timezone: 'Europe/Kyiv' });
    });

    it('leaves the schedule untouched when it was not edited', () => {
      const payload = buildBudgetEditPayload({ ...baseValues, limitAmount: null });

      expect('recurrence' in payload).toBe(false);
      expect('endDate' in payload).toBe(false);
    });
  });
});
