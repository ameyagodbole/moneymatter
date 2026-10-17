import type { BudgetCumulativeStep, BudgetPeriod, BudgetPeriodsResponse } from '@/api/budgets';
import { BUDGET_RECURRENCES, type RecordId, type endpointsTypes } from '@bt/shared/types';
import { getDate, getMonth, getYear } from 'date-fns';

/** Locale-aware date-fns `format`, as returned by `useDateLocale()`. */
type FormatDate = (date: Date | number, formatStr: string) => string;

type Recurrence = BudgetPeriodsResponse['recurrence'];
type Granularity = BudgetPeriodsResponse['cumulative']['granularity'];

const QUARTER_START_MONTHS = new Set([0, 3, 6, 9]);

/**
 * Short name for a period. Calendar-aligned periods get their calendar name
 * ("October 2026", "Q4 2026", "2026"); any other anchor gets its date range
 * ("Oct 25 – Nov 24, 2026").
 */
export const formatBudgetPeriodLabel = ({
  period,
  recurrence,
  format,
}: {
  period: Pick<BudgetPeriod, 'start' | 'end'>;
  recurrence: Recurrence;
  format: FormatDate;
}): string => {
  const start = new Date(period.start);
  const end = new Date(period.end);
  const startsOnFirst = getDate(start) === 1;

  if (startsOnFirst && recurrence === BUDGET_RECURRENCES.monthly) return format(start, 'LLLL yyyy');
  if (startsOnFirst && recurrence === BUDGET_RECURRENCES.quarterly && QUARTER_START_MONTHS.has(getMonth(start))) {
    return format(start, 'QQQ yyyy');
  }
  if (startsOnFirst && recurrence === BUDGET_RECURRENCES.yearly && getMonth(start) === 0) return format(start, 'yyyy');

  const startFormat = getYear(start) === getYear(end) ? 'MMM d' : 'MMM d, yyyy';
  return `${format(start, startFormat)} – ${format(end, 'MMM d, yyyy')}`;
};

/** An instant inside the period before or after `period`, to pass as `at`. */
export const getAdjacentPeriodAt = ({
  period,
  direction,
}: {
  period: Pick<BudgetPeriod, 'start' | 'end'>;
  direction: 'previous' | 'next';
}): Date =>
  direction === 'previous'
    ? new Date(new Date(period.start).getTime() - 1)
    : new Date(new Date(period.end).getTime() + 1);

/**
 * Whether a period after `period` exists and has started: false for the period
 * containing `now`, and for the last period of a series that has an end date.
 */
export const hasNextPeriod = ({
  period,
  seriesEnd,
  now = new Date(),
}: {
  period: Pick<BudgetPeriod, 'end'>;
  seriesEnd: Date | string | null | undefined;
  now?: Date;
}): boolean => {
  const end = new Date(period.end);
  if (end >= now) return false;
  return !seriesEnd || end < new Date(seriesEnd);
};

const STEP_LABEL_FORMATS: Record<Granularity, string> = {
  day: 'MMM d',
  week: 'MMM d',
  month: 'LLL',
};

/**
 * Running totals in the shape the Trends `CumulativeChart` takes. Its "month" axis is
 * just a position, so steps of any size fit; the label carries the real date. The
 * previous period is labelled by its own dates and aligned with the current one by
 * step number.
 */
export const toCumulativeChartData = ({
  steps,
  granularity,
  format,
}: {
  steps: BudgetCumulativeStep[];
  granularity: Granularity;
  format: FormatDate;
}): endpointsTypes.CumulativeMonthData[] =>
  steps.map((step) => ({
    month: step.step,
    monthLabel: format(new Date(step.stepStart), STEP_LABEL_FORMATS[granularity]),
    value: step.value,
    periodValue: step.periodValue,
  }));

/** Category spending in the shape the Trends `CategoryBreakdown` takes. */
export const toCategoryBreakdownData = ({
  spendingsByCategory,
}: {
  spendingsByCategory: endpointsTypes.BudgetSpendingStatsResponse['spendingsByCategory'] | undefined;
}): endpointsTypes.GetSpendingsByCategoriesReturnType =>
  Object.fromEntries(
    (spendingsByCategory ?? []).map((item) => [
      item.categoryId as RecordId,
      { name: item.name, color: item.color, amount: item.amount },
    ]),
  );

/** Percent change from `previous` to `current`, rounded; 0 when both are 0. */
export const getPercentChange = ({ current, previous }: { current: number; previous: number }): number => {
  if (previous === 0) return current === 0 ? 0 : 100;
  return Math.round(((current - previous) / Math.abs(previous)) * 100);
};
