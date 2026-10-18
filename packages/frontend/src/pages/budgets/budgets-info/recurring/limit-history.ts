import type { BudgetPeriodTotals } from '@/api/budgets';

export interface LimitHistory {
  /** Finished periods that had a positive limit to compare with. */
  periodsCount: number;
  /** Of those, how many stayed within the limit. */
  withinCount: number;
  /** Average of spent / limit over those periods, or null without any. */
  averageUsage: number | null;
}

/**
 * How past periods compared with their limits. Only finished periods count, since the
 * current one is still filling up; periods without a positive limit (none set, or
 * rollover used it all up) can't be compared and are left out.
 */
export const computeLimitHistory = ({
  periods,
  now = new Date(),
}: {
  periods: BudgetPeriodTotals[];
  now?: Date;
}): LimitHistory => {
  const finished = periods.filter(
    (period) => new Date(period.periodEnd) < now && period.limitAmount !== null && period.limitAmount > 0,
  );

  return {
    periodsCount: finished.length,
    withinCount: finished.filter((period) => period.spent <= period.limitAmount!).length,
    averageUsage: finished.length
      ? finished.reduce((sum, period) => sum + period.spent / period.limitAmount!, 0) / finished.length
      : null,
  };
};
