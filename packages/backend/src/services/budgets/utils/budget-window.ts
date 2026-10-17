import { BUDGET_TYPES } from '@bt/shared/types';
import type Budgets from '@models/budget.model';

import { type BudgetPeriod, isRecurringBudget, resolveBudgetPeriod } from './budget-periods';

export interface BudgetWindow {
  /** Inclusive bounds for the transaction query. Null leaves that side open. */
  from: Date | null;
  to: Date | null;
  /** The period the window covers, or null for one-off budgets. */
  period: BudgetPeriod | null;
}

/**
 * The time range a budget read covers.
 *
 * - Recurring budgets: the period containing `at` (default now), clamped to the series.
 * - One-off category budgets: the budget's own `startDate`/`endDate`, as before.
 * - One-off manual budgets: unbounded. Their scope is whatever is linked, and a row
 *   linked outside the date range has always counted.
 */
export const resolveBudgetWindow = ({
  budget,
  at,
}: {
  budget: Pick<Budgets, 'type' | 'recurrence' | 'timezone' | 'startDate' | 'endDate'>;
  at?: Date;
}): BudgetWindow => {
  if (isRecurringBudget(budget)) {
    const period = resolveBudgetPeriod({ budget, at });
    return { from: period.start, to: period.end, period };
  }

  if (budget.type === BUDGET_TYPES.manual) {
    return { from: null, to: null, period: null };
  }

  return { from: budget.startDate ?? null, to: budget.endDate ?? null, period: null };
};
