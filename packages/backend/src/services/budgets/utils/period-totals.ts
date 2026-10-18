import { BUDGET_ROLLOVERS } from '@bt/shared/types';

import type { BudgetPeriod } from './budget-periods';
import type { BudgetEntries } from './collect-budget-entries';

export interface PeriodNet {
  /** Cents, refunds netted. */
  expense: number;
  income: number;
}

/** Expense and income per period (same order as `periods`), refunds netted. */
export const sumEntriesByPeriod = ({
  periods,
  entries,
  refundAdjustments,
}: BudgetEntries & { periods: BudgetPeriod[] }): PeriodNet[] => {
  const totals = periods.map(() => ({ expense: 0, income: 0 }));
  const indexOf = (time: Date) => {
    const ms = new Date(time).getTime();
    return periods.findIndex((period) => ms >= period.start.getTime() && ms <= period.end.getTime());
  };

  for (const entry of entries) {
    const index = indexOf(entry.time);
    if (index === -1) continue;
    if (entry.isExpense) totals[index]!.expense += entry.cents;
    else totals[index]!.income += entry.cents;
  }
  for (const adjustment of refundAdjustments) {
    const index = indexOf(adjustment.time);
    if (index === -1) continue;
    if (adjustment.isExpense) totals[index]!.expense -= adjustment.cents;
    else totals[index]!.income -= adjustment.cents;
  }

  return totals;
};

/** Net outflow measured against the limit, never below zero. */
export const spentOf = ({ expense, income }: PeriodNet): number => Math.max(0, expense - income);

export interface EffectiveLimit {
  /** The limit for the period: the base limit plus what the previous period carried in. */
  limit: number;
  /** What the previous period carried in; negative when overspending is taken off. */
  carriedIn: number;
}

/**
 * The limit of each period once rollover applies, from the first period on. With
 * `surplus`, unspent limit carries forward; with `all`, overspending carries too, so a
 * period can start with less than the base limit (or below zero).
 */
export const computeEffectiveLimits = ({
  baseLimit,
  rollover,
  spentByPeriod,
}: {
  baseLimit: number;
  rollover: BUDGET_ROLLOVERS;
  spentByPeriod: number[];
}): EffectiveLimit[] => {
  let carry = 0;
  return spentByPeriod.map((spent) => {
    const effective = { limit: baseLimit + carry, carriedIn: carry };
    const leftover = effective.limit - spent;
    carry =
      rollover === BUDGET_ROLLOVERS.surplus ? Math.max(0, leftover) : rollover === BUDGET_ROLLOVERS.all ? leftover : 0;
    return effective;
  });
};
