import { BUDGET_RECURRENCES } from '@bt/shared/types';

import {
  type RecurringBudgetFields,
  isRecurringBudget,
  listBudgetPeriods,
  normalizeRecurringDates,
  resolveBudgetPeriod,
} from './budget-periods';

const budget = (overrides: Partial<RecurringBudgetFields> = {}): RecurringBudgetFields => ({
  recurrence: BUDGET_RECURRENCES.monthly,
  timezone: null,
  startDate: new Date('2026-01-01T00:00:00.000Z'),
  endDate: null,
  ...overrides,
});

const iso = (date: Date) => date.toISOString();

describe('isRecurringBudget', () => {
  it('is false for one-off budgets and for recurring ones without a start date', () => {
    expect(isRecurringBudget({ ...budget(), recurrence: BUDGET_RECURRENCES.none })).toBe(false);
    expect(isRecurringBudget({ ...budget(), startDate: null })).toBe(false);
    expect(isRecurringBudget(budget())).toBe(true);
  });
});

describe('resolveBudgetPeriod', () => {
  it('returns the calendar month containing the date', () => {
    const period = resolveBudgetPeriod({ budget: budget(), at: new Date('2026-10-17T12:00:00.000Z') });

    expect(period.index).toBe(9);
    expect(iso(period.start)).toBe('2026-10-01T00:00:00.000Z');
    expect(iso(period.end)).toBe('2026-10-31T23:59:59.999Z');
  });

  it('runs from the anchor day to the day before it when the anchor is mid-month', () => {
    const b = budget({ startDate: new Date('2026-01-25T00:00:00.000Z') });

    const beforeAnchorDay = resolveBudgetPeriod({ budget: b, at: new Date('2026-10-10T00:00:00.000Z') });
    expect(iso(beforeAnchorDay.start)).toBe('2026-09-25T00:00:00.000Z');
    expect(iso(beforeAnchorDay.end)).toBe('2026-10-24T23:59:59.999Z');

    const onAnchorDay = resolveBudgetPeriod({ budget: b, at: new Date('2026-10-25T00:00:00.000Z') });
    expect(iso(onAnchorDay.start)).toBe('2026-10-25T00:00:00.000Z');
  });

  it('clamps a day-31 anchor to short months without drifting', () => {
    const b = budget({ startDate: new Date('2026-01-31T00:00:00.000Z') });
    const periods = listBudgetPeriods({ budget: b, at: new Date('2026-04-15T00:00:00.000Z'), count: 4 });

    expect(periods.map((p) => iso(p.start))).toEqual([
      '2026-01-31T00:00:00.000Z',
      '2026-02-28T00:00:00.000Z',
      '2026-03-31T00:00:00.000Z',
    ]);
    expect(iso(periods[1]!.end)).toBe('2026-03-30T23:59:59.999Z');
  });

  it('cuts periods at local midnight in the budget timezone, across DST', () => {
    // Europe/Kyiv is UTC+2 in winter and UTC+3 in summer (DST starts 2026-03-29).
    const b = budget({ timezone: 'Europe/Kyiv', startDate: new Date('2025-12-31T22:00:00.000Z') });

    const march = resolveBudgetPeriod({ budget: b, at: new Date('2026-03-15T00:00:00.000Z') });
    expect(iso(march.start)).toBe('2026-02-28T22:00:00.000Z');
    expect(iso(march.end)).toBe('2026-03-31T20:59:59.999Z');

    const april = resolveBudgetPeriod({ budget: b, at: new Date('2026-04-01T00:00:00.000Z') });
    expect(iso(april.start)).toBe('2026-03-31T21:00:00.000Z');
  });

  it('puts an instant in the local month, not the UTC one', () => {
    // 2026-10-31T23:30Z is already November 1 in Kyiv.
    const b = budget({ timezone: 'Europe/Kyiv', startDate: new Date('2025-12-31T22:00:00.000Z') });
    const period = resolveBudgetPeriod({ budget: b, at: new Date('2026-10-31T23:30:00.000Z') });

    expect(iso(period.start)).toBe('2026-10-31T22:00:00.000Z');
  });

  it('steps by three months for quarterly budgets and by a year for yearly ones', () => {
    const quarterly = resolveBudgetPeriod({
      budget: budget({ recurrence: BUDGET_RECURRENCES.quarterly }),
      at: new Date('2026-08-20T00:00:00.000Z'),
    });
    expect(iso(quarterly.start)).toBe('2026-07-01T00:00:00.000Z');
    expect(iso(quarterly.end)).toBe('2026-09-30T23:59:59.999Z');

    const fiscalYear = resolveBudgetPeriod({
      budget: budget({ recurrence: BUDGET_RECURRENCES.yearly, startDate: new Date('2025-04-01T00:00:00.000Z') }),
      at: new Date('2026-02-01T00:00:00.000Z'),
    });
    expect(iso(fiscalYear.start)).toBe('2025-04-01T00:00:00.000Z');
    expect(iso(fiscalYear.end)).toBe('2026-03-31T23:59:59.999Z');
  });

  it('returns the first period before the series starts and the last one after it ends', () => {
    const b = budget({ endDate: new Date('2026-03-31T23:59:59.999Z') });

    expect(resolveBudgetPeriod({ budget: b, at: new Date('2025-06-01T00:00:00.000Z') }).index).toBe(0);
    expect(resolveBudgetPeriod({ budget: b, at: new Date('2027-06-01T00:00:00.000Z') }).index).toBe(2);
  });
});

describe('listBudgetPeriods', () => {
  it('lists the most recent periods oldest first', () => {
    const periods = listBudgetPeriods({ budget: budget(), at: new Date('2026-10-17T00:00:00.000Z'), count: 3 });

    expect(periods.map((p) => p.index)).toEqual([7, 8, 9]);
  });

  it('never reaches before the first period', () => {
    const periods = listBudgetPeriods({ budget: budget(), at: new Date('2026-02-10T00:00:00.000Z'), count: 12 });

    expect(periods.map((p) => p.index)).toEqual([0, 1]);
  });
});

describe('normalizeRecurringDates', () => {
  it('moves the start to local midnight and the end to the end of its period', () => {
    const { startDate, endDate } = normalizeRecurringDates({
      budget: budget({
        startDate: new Date('2026-01-25T15:42:00.000Z'),
        endDate: new Date('2026-06-03T10:00:00.000Z'),
      }),
    });

    expect(iso(startDate)).toBe('2026-01-25T00:00:00.000Z');
    // June 3 falls in the May 25 – June 24 period.
    expect(iso(endDate!)).toBe('2026-06-24T23:59:59.999Z');
  });

  it('keeps an open-ended series open', () => {
    expect(normalizeRecurringDates({ budget: budget() }).endDate).toBeNull();
  });

  it('extends an end date inside the first period to the end of that period', () => {
    const { endDate } = normalizeRecurringDates({
      budget: budget({ endDate: new Date('2026-01-10T00:00:00.000Z') }),
    });

    expect(iso(endDate!)).toBe('2026-01-31T23:59:59.999Z');
  });
});
