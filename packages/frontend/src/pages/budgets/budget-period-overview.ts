import type { StatsResponse } from '@/api/budgets';
import { BUDGET_RECURRENCES, BUDGET_STATUSES, type BudgetModel } from '@bt/shared/types';

export interface PeriodOverviewGroup {
  recurrence: Exclude<BUDGET_RECURRENCES, BUDGET_RECURRENCES.none>;
  budgetsCount: number;
  spent: number;
  limit: number;
  overLimitCount: number;
}

const RECURRENCE_ORDER = [BUDGET_RECURRENCES.monthly, BUDGET_RECURRENCES.quarterly, BUDGET_RECURRENCES.yearly] as const;

/**
 * Totals of the current period across active recurring budgets with a limit, one group
 * per cadence (adding a monthly and a yearly limit together would mean nothing). Budgets
 * whose stats haven't loaded, or whose series has ended, are left out.
 */
export const buildPeriodOverview = ({
  budgets,
  getStats,
  now = new Date(),
}: {
  budgets: Pick<BudgetModel, 'id' | 'status' | 'recurrence' | 'endDate'>[];
  getStats: (budgetId: string) => StatsResponse | null;
  now?: Date;
}): PeriodOverviewGroup[] => {
  const groups = new Map<PeriodOverviewGroup['recurrence'], PeriodOverviewGroup>();

  for (const budget of budgets) {
    if (budget.status !== BUDGET_STATUSES.active || budget.recurrence === BUDGET_RECURRENCES.none) continue;
    if (budget.endDate && new Date(budget.endDate) < now) continue;

    const stats = getStats(budget.id);
    const limit = stats?.summary.limitAmount;
    if (!stats || limit === null || limit === undefined) continue;

    const spent = Math.max(0, -stats.summary.balance);
    const recurrence = budget.recurrence as PeriodOverviewGroup['recurrence'];
    const group = groups.get(recurrence) ?? { recurrence, budgetsCount: 0, spent: 0, limit: 0, overLimitCount: 0 };

    group.budgetsCount += 1;
    group.spent += spent;
    group.limit += limit;
    if (spent > limit) group.overLimitCount += 1;
    groups.set(recurrence, group);
  }

  return RECURRENCE_ORDER.flatMap((recurrence) => groups.get(recurrence) ?? []);
};
