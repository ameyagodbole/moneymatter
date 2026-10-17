import { BUDGET_RECURRENCES, type RecordId } from '@bt/shared/types';
import { format } from 'date-fns';
import { describe, expect, it } from 'vitest';

import {
  formatBudgetPeriodLabel,
  getAdjacentPeriodAt,
  getPercentChange,
  hasNextPeriod,
  toCategoryBreakdownData,
  toCumulativeChartData,
} from './budget-period-utils';

// Local-time boundaries, as the backend sends them for a budget in the browser's zone.
const local = (year: number, month: number, day: number) => new Date(year, month - 1, day).toISOString();
const endOfLocalDay = (year: number, month: number, day: number) =>
  new Date(year, month - 1, day, 23, 59, 59, 999).toISOString();

describe('formatBudgetPeriodLabel', () => {
  it('names calendar months, quarters and years', () => {
    expect(
      formatBudgetPeriodLabel({
        period: { start: local(2026, 10, 1), end: endOfLocalDay(2026, 10, 31) },
        recurrence: BUDGET_RECURRENCES.monthly,
        format,
      }),
    ).toBe('October 2026');
    expect(
      formatBudgetPeriodLabel({
        period: { start: local(2026, 10, 1), end: endOfLocalDay(2026, 12, 31) },
        recurrence: BUDGET_RECURRENCES.quarterly,
        format,
      }),
    ).toBe('Q4 2026');
    expect(
      formatBudgetPeriodLabel({
        period: { start: local(2026, 1, 1), end: endOfLocalDay(2026, 12, 31) },
        recurrence: BUDGET_RECURRENCES.yearly,
        format,
      }),
    ).toBe('2026');
  });

  it('falls back to the date range for other anchors', () => {
    expect(
      formatBudgetPeriodLabel({
        period: { start: local(2026, 10, 25), end: endOfLocalDay(2026, 11, 24) },
        recurrence: BUDGET_RECURRENCES.monthly,
        format,
      }),
    ).toBe('Oct 25 – Nov 24, 2026');
    expect(
      formatBudgetPeriodLabel({
        period: { start: local(2025, 4, 1), end: endOfLocalDay(2026, 3, 31) },
        recurrence: BUDGET_RECURRENCES.yearly,
        format,
      }),
    ).toBe('Apr 1, 2025 – Mar 31, 2026');
  });
});

describe('getAdjacentPeriodAt', () => {
  const period = { start: '2026-10-01T00:00:00.000Z', end: '2026-10-31T23:59:59.999Z' };

  it('lands just outside the period on either side', () => {
    expect(getAdjacentPeriodAt({ period, direction: 'previous' }).toISOString()).toBe('2026-09-30T23:59:59.999Z');
    expect(getAdjacentPeriodAt({ period, direction: 'next' }).toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });
});

describe('hasNextPeriod', () => {
  const now = new Date('2026-10-17T12:00:00.000Z');

  it('is false for the period containing now', () => {
    expect(hasNextPeriod({ period: { end: '2026-10-31T23:59:59.999Z' }, seriesEnd: null, now })).toBe(false);
  });

  it('is true for past periods of an open-ended series', () => {
    expect(hasNextPeriod({ period: { end: '2026-09-30T23:59:59.999Z' }, seriesEnd: null, now })).toBe(true);
  });

  it('is false for the last period of a series that ended', () => {
    expect(
      hasNextPeriod({ period: { end: '2026-06-30T23:59:59.999Z' }, seriesEnd: '2026-06-30T23:59:59.999Z', now }),
    ).toBe(false);
  });
});

describe('toCumulativeChartData', () => {
  it('maps steps to chart points labelled by their own dates', () => {
    const data = toCumulativeChartData({
      steps: [
        { step: 1, stepStart: local(2026, 10, 1), value: 0, periodValue: 0 },
        { step: 2, stepStart: local(2026, 10, 2), value: 40, periodValue: 40 },
      ],
      granularity: 'day',
      format,
    });

    expect(data).toEqual([
      { month: 1, monthLabel: 'Oct 1', value: 0, periodValue: 0 },
      { month: 2, monthLabel: 'Oct 2', value: 40, periodValue: 40 },
    ]);
  });
});

describe('toCategoryBreakdownData', () => {
  it('keys spending by category id', () => {
    expect(
      toCategoryBreakdownData({
        spendingsByCategory: [{ categoryId: 'cat-1' as RecordId, name: 'Groceries', color: '#f00', amount: 40 }],
      }),
    ).toEqual({ 'cat-1': { name: 'Groceries', color: '#f00', amount: 40 } });
    expect(toCategoryBreakdownData({ spendingsByCategory: undefined })).toEqual({});
  });
});

describe('getPercentChange', () => {
  it('compares against the previous value', () => {
    expect(getPercentChange({ current: 150, previous: 100 })).toBe(50);
    expect(getPercentChange({ current: 50, previous: 100 })).toBe(-50);
    expect(getPercentChange({ current: 0, previous: 0 })).toBe(0);
    expect(getPercentChange({ current: 20, previous: 0 })).toBe(100);
  });
});
