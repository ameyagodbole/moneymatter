import { BUDGET_ROLLOVERS } from '@bt/shared/types';
import type Budgets from '@models/budget.model';

import { getBudgetPeriodByIndex, isRecurringBudget } from './budget-periods';
import { type BudgetEntries, collectBudgetEntries } from './collect-budget-entries';
import { type EffectiveLimit, computeEffectiveLimits, spentOf, sumEntriesByPeriod } from './period-totals';

type LimitBudget = Pick<
  Budgets,
  'id' | 'type' | 'rules' | 'recurrence' | 'timezone' | 'startDate' | 'endDate' | 'rollover' | 'limitAmount'
> & { categories?: { id: string }[] };

/**
 * The limit of periods 0..`uptoIndex` of a budget, rollover applied. Null when the budget
 * has no limit. Without rollover every period gets the base limit and nothing is
 * collected; with it, spending is collected from the first period on, because each
 * period's carry depends on all the ones before it.
 *
 * Pass `collected` when the caller already holds the entries for that whole range.
 */
export const resolvePeriodLimits = async ({
  budget,
  uptoIndex,
  ownerUserId,
  callerUserId,
  isOwner,
  collected,
}: {
  budget: LimitBudget;
  uptoIndex: number;
  ownerUserId: number;
  callerUserId: number;
  isOwner: boolean;
  collected?: BudgetEntries;
}): Promise<EffectiveLimit[] | null> => {
  const baseLimit = budget.limitAmount?.toCents() ?? null;
  if (baseLimit === null) return null;

  const fields = {
    recurrence: budget.recurrence,
    timezone: budget.timezone,
    startDate: budget.startDate,
    endDate: budget.endDate,
  };

  if (!isRecurringBudget(fields) || budget.rollover === BUDGET_ROLLOVERS.none) {
    return Array.from({ length: uptoIndex + 1 }, () => ({ limit: baseLimit, carriedIn: 0 }));
  }

  const periods = Array.from({ length: uptoIndex + 1 }, (_, index) =>
    getBudgetPeriodByIndex({ budget: fields, index }),
  );
  const entries =
    collected ??
    (await collectBudgetEntries({
      budget,
      ownerUserId,
      callerUserId,
      isOwner,
      from: periods[0]!.start,
      to: periods[periods.length - 1]!.end,
    }));

  const spentByPeriod = sumEntriesByPeriod({ periods, ...entries }).map(spentOf);
  return computeEffectiveLimits({ baseLimit, rollover: budget.rollover, spentByPeriod });
};

/** First-period start, for callers widening a collection so rollover can be computed from it. */
export const getFirstPeriodStart = ({ budget }: { budget: LimitBudget }): Date | null => {
  const fields = {
    recurrence: budget.recurrence,
    timezone: budget.timezone,
    startDate: budget.startDate,
    endDate: budget.endDate,
  };
  return isRecurringBudget(fields) ? getBudgetPeriodByIndex({ budget: fields, index: 0 }).start : null;
};
