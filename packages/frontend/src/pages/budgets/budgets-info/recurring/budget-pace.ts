import { differenceInCalendarDays } from 'date-fns';

export interface BudgetPace {
  /** Share of the period gone, 0–1. */
  elapsedRatio: number;
  /** Spending you'd expect by now if it were spread evenly over the period. */
  expectedSpent: number;
  /** Spent minus expected: positive when ahead of pace (spending faster). */
  paceDelta: number;
  /** Spending at the period's end if it keeps the current rate. */
  projectedSpent: number;
  /** Days left including today. */
  daysLeft: number;
  /** What's left of the limit for the rest of the period; negative once it's exceeded. */
  remaining: number;
}

/**
 * How spending in the current period compares with an even pace through it. Null when
 * there's no positive limit to pace against or `now` is outside the period.
 */
export const computeBudgetPace = ({
  periodStart,
  periodEnd,
  spent,
  limit,
  now = new Date(),
}: {
  periodStart: Date | string;
  periodEnd: Date | string;
  spent: number;
  limit: number | null;
  now?: Date;
}): BudgetPace | null => {
  const start = new Date(periodStart);
  const end = new Date(periodEnd);
  if (limit === null || limit <= 0 || now < start || now > end) return null;

  const elapsedRatio = Math.min(1, Math.max(0, (now.getTime() - start.getTime()) / (end.getTime() - start.getTime())));
  const expectedSpent = limit * elapsedRatio;
  const daysLeft = differenceInCalendarDays(end, now) + 1;

  return {
    elapsedRatio,
    expectedSpent,
    paceDelta: spent - expectedSpent,
    projectedSpent: elapsedRatio > 0 ? spent / elapsedRatio : spent,
    daysLeft,
    remaining: limit - spent,
  };
};
