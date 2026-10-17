import type { BudgetPeriod } from '@/api/budgets';
import { BUDGET_RECURRENCES } from '@bt/shared/types';
import { differenceInDays, isWithinInterval } from 'date-fns';

export type BudgetTimeStatus =
  | { status: 'ended' }
  | { status: 'active'; daysLeft: number }
  | { status: 'upcoming'; daysUntil: number };

/**
 * Where a budget stands in time.
 *
 * One-off budgets measure against their own `startDate`/`endDate`. Recurring budgets
 * measure against the current period from their stats (`period`): active with the days
 * left in that period, upcoming before the first one starts, ended once the series'
 * `endDate` has passed. Returns null when there is nothing to measure against yet: a
 * one-off budget with no dates, or a recurring one whose stats haven't loaded.
 */
export const getBudgetTimeStatus = ({
  budget,
  period,
  now = new Date(),
}: {
  budget: { recurrence: BUDGET_RECURRENCES; startDate?: Date | string | null; endDate?: Date | string | null };
  period?: BudgetPeriod | null;
  now?: Date;
}): BudgetTimeStatus | null => {
  const startDate = budget.startDate ? new Date(budget.startDate) : null;
  const endDate = budget.endDate ? new Date(budget.endDate) : null;

  if (endDate && endDate < now) return { status: 'ended' };

  if (startDate && startDate > now) return { status: 'upcoming', daysUntil: differenceInDays(startDate, now) };

  if (budget.recurrence !== BUDGET_RECURRENCES.none) {
    if (!period) return null;
    return { status: 'active', daysLeft: differenceInDays(new Date(period.end), now) };
  }

  if (startDate && endDate && isWithinInterval(now, { start: startDate, end: endDate })) {
    return { status: 'active', daysLeft: differenceInDays(endDate, now) };
  }

  if (endDate) return { status: 'active', daysLeft: differenceInDays(endDate, now) };

  return null;
};

type Translate = (key: string, params?: Record<string, unknown>) => string;

/** User-facing text for a time status, e.g. "12 days left" or "Starts tomorrow". */
export const formatBudgetTimeStatus = ({ status, t }: { status: BudgetTimeStatus; t: Translate }): string => {
  if (status.status === 'ended') return t('budgets.list.status.ended');
  if (status.status === 'upcoming') {
    if (status.daysUntil === 0) return t('budgets.list.status.startsToday');
    if (status.daysUntil === 1) return t('budgets.list.status.startsTomorrow');
    return t('budgets.list.status.startsInDays', { count: status.daysUntil });
  }
  if (status.daysLeft === 0) return t('budgets.list.status.lastDay');
  if (status.daysLeft === 1) return t('budgets.list.status.oneDayLeft');
  return t('budgets.list.status.daysLeft', { count: status.daysLeft });
};
