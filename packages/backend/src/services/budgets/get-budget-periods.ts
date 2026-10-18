import { BUDGET_ROLLOVERS } from '@bt/shared/types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import Budgets from '@models/budget.model';
import Categories from '@models/categories.model';

import { authorizeBudgetRead } from './authorize-budget-access';
import { computeUtilizationRate } from './stats';
import {
  type BudgetPeriod,
  CUMULATIVE_GRANULARITY,
  type CumulativeGranularity,
  type RecurringBudgetRecurrence,
  getBudgetPeriodByIndex,
  isRecurringBudget,
  listBudgetPeriods,
  listCumulativeStepStarts,
} from './utils/budget-periods';
import { type BudgetEntries, collectBudgetEntries } from './utils/collect-budget-entries';
import { getFirstPeriodStart, resolvePeriodLimits } from './utils/resolve-period-limits';

export interface BudgetPeriodTotals {
  index: number;
  periodStart: Date;
  periodEnd: Date;
  /** Cents, refunds netted. */
  expense: number;
  income: number;
  /** Net outflow, never below zero: what the limit is compared against. */
  spent: number;
  limitAmount: number | null;
  utilizationRate: number | null;
}

export interface CumulativeStep {
  /** 1-based position inside the period. */
  step: number;
  stepStart: Date;
  /** Net spending (expense − income) up to the end of this step, in cents. */
  value: number;
  /** Net spending within this step alone, in cents. */
  periodValue: number;
}

export interface BudgetPeriodsResponse {
  recurrence: RecurringBudgetRecurrence;
  periods: BudgetPeriodTotals[];
  cumulative: {
    granularity: CumulativeGranularity;
    current: CumulativeStep[];
    /** Empty when the selected period is the first one. */
    previous: CumulativeStep[];
  };
}

/** Signed amounts (+ for expense, − for income) with their time, refunds already netted. */
const toSignedAmounts = ({ entries, refundAdjustments }: BudgetEntries) => [
  ...entries.map((entry) => ({
    time: entry.time,
    expense: entry.isExpense ? entry.cents : 0,
    income: entry.isExpense ? 0 : entry.cents,
  })),
  ...refundAdjustments.map((adj) => ({
    time: adj.time,
    expense: adj.isExpense ? -adj.cents : 0,
    income: adj.isExpense ? 0 : -adj.cents,
  })),
];

type SignedAmount = ReturnType<typeof toSignedAmounts>[number];

const inRange = ({ time, start, end }: { time: Date; start: Date; end: Date }) => {
  const ms = new Date(time).getTime();
  return ms >= start.getTime() && ms <= end.getTime();
};

const totalsForPeriod = ({
  period,
  amounts,
  limitAmount,
}: {
  period: BudgetPeriod;
  amounts: SignedAmount[];
  limitAmount: number | null;
}): BudgetPeriodTotals => {
  let expense = 0;
  let income = 0;
  for (const amount of amounts) {
    if (!inRange({ time: amount.time, start: period.start, end: period.end })) continue;
    expense += amount.expense;
    income += amount.income;
  }

  return {
    index: period.index,
    periodStart: period.start,
    periodEnd: period.end,
    expense,
    income,
    spent: Math.max(0, expense - income),
    limitAmount,
    utilizationRate: computeUtilizationRate({ income, expense, limitAmount }),
  };
};

/**
 * Running net spending through `period`, one point per step. Steps that start after
 * `now` are left out, so the current period's line stops at today.
 */
const cumulativeForPeriod = ({
  period,
  amounts,
  granularity,
  timezone,
  now,
}: {
  period: BudgetPeriod;
  amounts: SignedAmount[];
  granularity: CumulativeGranularity;
  timezone: string | null;
  now: Date;
}): CumulativeStep[] => {
  const starts = listCumulativeStepStarts({ period, granularity, timezone }).filter((start) => start <= now);
  const steps: CumulativeStep[] = [];
  let running = 0;

  starts.forEach((stepStart, i) => {
    const nextStart = starts[i + 1];
    const stepEnd = nextStart ? new Date(nextStart.getTime() - 1) : period.end;

    let periodValue = 0;
    for (const amount of amounts) {
      if (inRange({ time: amount.time, start: stepStart, end: stepEnd })) {
        periodValue += amount.expense - amount.income;
      }
    }

    running += periodValue;
    steps.push({ step: i + 1, stepStart, value: running, periodValue });
  });

  return steps;
};

/**
 * Totals for the last `count` periods of a recurring budget, ending with the period
 * containing `at`, plus running totals for that period and the one before it.
 *
 * Every amount comes from one collection over the whole range, bucketed in memory, using
 * the same scope rules as `/stats`.
 */
export const getBudgetPeriods = async ({
  userId,
  budgetId,
  at = new Date(),
  count,
}: {
  userId: number;
  budgetId: string;
  at?: Date;
  count: number;
}): Promise<BudgetPeriodsResponse> => {
  const { ownerUserId, isOwner } = await authorizeBudgetRead({ userId, budgetId });

  const budget = await findOrThrowNotFound({
    query: Budgets.findByPk(budgetId, {
      include: [{ model: Categories, as: 'categories', attributes: ['id'] }],
    }),
    message: t({ key: 'budgets.budgetNotFound' }),
  });

  const recurringFields = {
    recurrence: budget.recurrence,
    timezone: budget.timezone,
    startDate: budget.startDate,
    endDate: budget.endDate,
  };

  if (!isRecurringBudget(recurringFields)) {
    throw new ValidationError({ message: t({ key: 'budgets.notRecurringBudget' }) });
  }

  const periods = listBudgetPeriods({ budget: recurringFields, at, count });
  const current = periods[periods.length - 1]!;
  const previous =
    current.index > 0 ? getBudgetPeriodByIndex({ budget: recurringFields, index: current.index - 1 }) : null;
  const firstListed = previous && previous.start < periods[0]!.start ? previous.start : periods[0]!.start;
  // Rollover makes each limit depend on every period before it, so collect from the first one.
  const withRollover = budget.rollover !== BUDGET_ROLLOVERS.none && budget.limitAmount !== null;
  const rangeStart = withRollover ? (getFirstPeriodStart({ budget }) ?? firstListed) : firstListed;

  const collected = await collectBudgetEntries({
    budget,
    ownerUserId,
    callerUserId: userId,
    isOwner,
    from: rangeStart,
    to: current.end,
  });

  const amounts = toSignedAmounts(collected);
  const limits = await resolvePeriodLimits({
    budget,
    uptoIndex: current.index,
    ownerUserId,
    callerUserId: userId,
    isOwner,
    collected,
  });
  const granularity = CUMULATIVE_GRANULARITY[recurringFields.recurrence];
  const now = new Date();

  return {
    recurrence: recurringFields.recurrence,
    periods: periods.map((period) =>
      totalsForPeriod({ period, amounts, limitAmount: limits?.[period.index]?.limit ?? null }),
    ),
    cumulative: {
      granularity,
      current: cumulativeForPeriod({ period: current, amounts, granularity, timezone: budget.timezone, now }),
      previous: previous
        ? cumulativeForPeriod({ period: previous, amounts, granularity, timezone: budget.timezone, now })
        : [],
    },
  };
};
