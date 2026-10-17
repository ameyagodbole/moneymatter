import { BUDGET_RECURRENCES } from '@bt/shared/types';
import { type WallClock, instantToZonedWallClock, zonedWallClockToInstant } from '@common/utils/zoned-time';

export type RecurringBudgetRecurrence = Exclude<BUDGET_RECURRENCES, BUDGET_RECURRENCES.none>;

const STEP_MONTHS: Record<RecurringBudgetRecurrence, number> = {
  [BUDGET_RECURRENCES.monthly]: 1,
  [BUDGET_RECURRENCES.quarterly]: 3,
  [BUDGET_RECURRENCES.yearly]: 12,
};

export interface BudgetPeriod {
  /** 0 for the first period of the series. */
  index: number;
  start: Date;
  /** Last millisecond of the period, so `[start, end]` works with `Op.between`. */
  end: Date;
}

export interface RecurringBudgetFields {
  recurrence: RecurringBudgetRecurrence;
  timezone: string | null;
  startDate: Date;
  endDate: Date | null;
}

interface PeriodBudgetFields {
  recurrence: BUDGET_RECURRENCES;
  timezone: string | null;
  startDate: Date | null;
  endDate: Date | null;
}

export const isRecurringBudget = (budget: PeriodBudgetFields): budget is RecurringBudgetFields =>
  budget.recurrence !== BUDGET_RECURRENCES.none && budget.startDate !== null;

const daysInMonth = ({ year, month }: { year: number; month: number }) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

const getAnchor = ({ budget }: { budget: Pick<RecurringBudgetFields, 'startDate' | 'timezone'> }): WallClock =>
  instantToZonedWallClock({ instant: new Date(budget.startDate), timezone: budget.timezone });

/**
 * Start of period `index`: local midnight of `anchor + index × step months`. Always
 * computed from the anchor, never from the previous period, so a day-31 anchor gives
 * Jan 31 → Feb 28/29 → Mar 31 instead of drifting to the 28th.
 */
const getPeriodStart = ({
  anchor,
  stepMonths,
  index,
  timezone,
}: {
  anchor: WallClock;
  stepMonths: number;
  index: number;
  timezone: string | null;
}): Date => {
  const monthOffset = anchor.month - 1 + index * stepMonths;
  const year = anchor.year + Math.floor(monthOffset / 12);
  const month = (((monthOffset % 12) + 12) % 12) + 1;
  const day = Math.min(anchor.day, daysInMonth({ year, month }));

  return zonedWallClockToInstant({
    wall: { year, month, day, hour: 0, minute: 0, second: 0, ms: 0 },
    timezone,
  });
};

const buildPeriod = ({
  anchor,
  stepMonths,
  index,
  timezone,
}: {
  anchor: WallClock;
  stepMonths: number;
  index: number;
  timezone: string | null;
}): BudgetPeriod => ({
  index,
  start: getPeriodStart({ anchor, stepMonths, index, timezone }),
  end: new Date(getPeriodStart({ anchor, stepMonths, index: index + 1, timezone }).getTime() - 1),
});

/** Index of the period containing `at`, unclamped: negative before the series starts. */
const getUnclampedIndex = ({
  anchor,
  stepMonths,
  timezone,
  at,
}: {
  anchor: WallClock;
  stepMonths: number;
  timezone: string | null;
  at: Date;
}): number => {
  const wall = instantToZonedWallClock({ instant: at, timezone });
  const monthsSinceAnchor = (wall.year - anchor.year) * 12 + (wall.month - anchor.month);
  let index = Math.floor(monthsSinceAnchor / stepMonths);

  // The month difference ignores the anchor day (a 25th anchor puts Oct 10 in the
  // September period), so settle the estimate against the real boundaries.
  while (getPeriodStart({ anchor, stepMonths, index, timezone }) > at) index -= 1;
  while (getPeriodStart({ anchor, stepMonths, index: index + 1, timezone }) <= at) index += 1;

  return index;
};

const getLastIndex = ({
  budget,
  anchor,
  stepMonths,
}: {
  budget: RecurringBudgetFields;
  anchor: WallClock;
  stepMonths: number;
}): number =>
  budget.endDate
    ? Math.max(0, getUnclampedIndex({ anchor, stepMonths, timezone: budget.timezone, at: new Date(budget.endDate) }))
    : Number.POSITIVE_INFINITY;

/**
 * The period containing `at`, clamped to the series: before the first period this
 * returns period 0, after `endDate` the last period.
 */
export const resolveBudgetPeriod = ({
  budget,
  at = new Date(),
}: {
  budget: RecurringBudgetFields;
  at?: Date;
}): BudgetPeriod => {
  const anchor = getAnchor({ budget });
  const stepMonths = STEP_MONTHS[budget.recurrence];
  const lastIndex = getLastIndex({ budget, anchor, stepMonths });
  const index = Math.min(
    lastIndex,
    Math.max(0, getUnclampedIndex({ anchor, stepMonths, timezone: budget.timezone, at })),
  );

  return buildPeriod({ anchor, stepMonths, index, timezone: budget.timezone });
};

/**
 * Up to `count` periods ending with the one containing `at`, oldest first. Never
 * reaches before period 0.
 */
export const listBudgetPeriods = ({
  budget,
  at = new Date(),
  count,
}: {
  budget: RecurringBudgetFields;
  at?: Date;
  count: number;
}): BudgetPeriod[] => {
  const anchor = getAnchor({ budget });
  const stepMonths = STEP_MONTHS[budget.recurrence];
  const { index: lastIndex } = resolveBudgetPeriod({ budget, at });
  const firstIndex = Math.max(0, lastIndex - count + 1);

  const periods: BudgetPeriod[] = [];
  for (let index = firstIndex; index <= lastIndex; index += 1) {
    periods.push(buildPeriod({ anchor, stepMonths, index, timezone: budget.timezone }));
  }
  return periods;
};

/**
 * Normalises the dates of a recurring budget before they are stored: `startDate`
 * becomes local midnight of its own calendar day, and `endDate` (when set) is moved
 * to the end of the period containing it, so a series never ends on a half period.
 */
export const normalizeRecurringDates = ({
  budget,
}: {
  budget: RecurringBudgetFields;
}): { startDate: Date; endDate: Date | null } => {
  const anchor = getAnchor({ budget });
  const stepMonths = STEP_MONTHS[budget.recurrence];
  const startDate = getPeriodStart({ anchor, stepMonths, index: 0, timezone: budget.timezone });

  if (!budget.endDate) return { startDate, endDate: null };

  const lastIndex = getLastIndex({ budget, anchor, stepMonths });
  const { end } = buildPeriod({ anchor, stepMonths, index: lastIndex, timezone: budget.timezone });
  return { startDate, endDate: end };
};

/** Period `index` of the series, without clamping to `endDate`. */
export const getBudgetPeriodByIndex = ({
  budget,
  index,
}: {
  budget: RecurringBudgetFields;
  index: number;
}): BudgetPeriod =>
  buildPeriod({
    anchor: getAnchor({ budget }),
    stepMonths: STEP_MONTHS[budget.recurrence],
    index,
    timezone: budget.timezone,
  });

export type CumulativeGranularity = 'day' | 'week' | 'month';

/** Step size of the cumulative chart: about 30, 13 or 12 points per period. */
export const CUMULATIVE_GRANULARITY: Record<RecurringBudgetRecurrence, CumulativeGranularity> = {
  [BUDGET_RECURRENCES.monthly]: 'day',
  [BUDGET_RECURRENCES.quarterly]: 'week',
  [BUDGET_RECURRENCES.yearly]: 'month',
};

/**
 * Start of every cumulative step inside `period`, in local time: each day, each 7 days
 * from the period start, or each month from it.
 */
export const listCumulativeStepStarts = ({
  period,
  granularity,
  timezone,
}: {
  period: BudgetPeriod;
  granularity: CumulativeGranularity;
  timezone: string | null;
}): Date[] => {
  const anchor = instantToZonedWallClock({ instant: period.start, timezone });
  const starts: Date[] = [];

  for (let step = 0; ; step += 1) {
    const start =
      granularity === 'month'
        ? getPeriodStart({ anchor, stepMonths: 1, index: step, timezone })
        : zonedWallClockToInstant({
            // Date.UTC rolls an overflowing day into the next month, so adding days is safe.
            wall: {
              ...anchor,
              day: anchor.day + step * (granularity === 'week' ? 7 : 1),
              hour: 0,
              minute: 0,
              second: 0,
              ms: 0,
            },
            timezone,
          });
    if (start > period.end) break;
    starts.push(start);
  }

  return starts;
};
