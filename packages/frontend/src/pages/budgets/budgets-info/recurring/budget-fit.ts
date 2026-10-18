import type { BudgetPeriodTotals } from '@/api/budgets';

/** Below this many finished periods there's too little history to judge a limit. */
export const MIN_PERIODS_FOR_VERDICT = 3;
/** Overspending in more than this share of periods makes a limit "too tight". */
const TOO_TIGHT_OVER_SHARE = 0.5;
/** Never going over while using less than this share of the limit on average makes it "roomy". */
const ROOMY_AVERAGE_USAGE = 0.75;
/** The suggested limit would have covered this share of past periods. */
const SUGGESTION_COVERAGE = 0.8;

export type BudgetFitVerdict = 'insufficient' | 'tooTight' | 'realistic' | 'roomy';

export interface PeriodVariance {
  index: number;
  periodStart: string;
  periodEnd: string;
  spent: number;
  limit: number;
  /** Spent minus limit: positive when over. */
  difference: number;
  /** `difference` as a share of the limit, e.g. 0.18 for 18% over. */
  ratio: number;
}

export interface BudgetFit {
  /** Finished periods with a limit, oldest first. */
  periods: PeriodVariance[];
  overCount: number;
  /** Average of spent / limit over the finished periods. */
  averageUsage: number | null;
  verdict: BudgetFitVerdict;
  /** A limit that would have covered `SUGGESTION_COVERAGE` of past periods; set for tooTight and roomy. */
  suggestedLimit: number | null;
}

/** Rounds up to two significant figures' worth of step: 437 → 440, 1234 → 1300, 87 → 87. */
export const roundUpToNiceLimit = ({ amount }: { amount: number }): number => {
  if (amount <= 0) return 0;
  const digits = Math.floor(Math.log10(amount)) + 1;
  const step = Math.max(1, 10 ** (digits - 2));
  return Math.ceil(amount / step) * step;
};

/** Nearest-rank percentile of `values` (0 < share ≤ 1). */
const percentile = ({ values, share }: { values: number[]; share: number }): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(share * sorted.length));
  return sorted[rank - 1]!;
};

/**
 * How well a recurring budget's limit has matched real spending. Only finished periods
 * count, since the current one is still filling up; periods without a positive limit
 * (no limit set, or rollover used it all up) can't be compared and are left out.
 */
export const computeBudgetFit = ({
  periods,
  now = new Date(),
}: {
  periods: BudgetPeriodTotals[];
  now?: Date;
}): BudgetFit => {
  const finished: PeriodVariance[] = periods
    .filter((period) => new Date(period.periodEnd) < now && period.limitAmount !== null && period.limitAmount > 0)
    .map((period) => {
      const limit = period.limitAmount!;
      const difference = period.spent - limit;
      return {
        index: period.index,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        spent: period.spent,
        limit,
        difference,
        ratio: difference / limit,
      };
    });

  const overCount = finished.filter((period) => period.difference > 0).length;
  const averageUsage = finished.length
    ? finished.reduce((sum, period) => sum + period.spent / period.limit, 0) / finished.length
    : null;

  if (finished.length < MIN_PERIODS_FOR_VERDICT || averageUsage === null) {
    return { periods: finished, overCount, averageUsage, verdict: 'insufficient', suggestedLimit: null };
  }

  const verdict: BudgetFitVerdict =
    overCount / finished.length > TOO_TIGHT_OVER_SHARE
      ? 'tooTight'
      : overCount === 0 && averageUsage < ROOMY_AVERAGE_USAGE
        ? 'roomy'
        : 'realistic';

  const suggestedLimit =
    verdict === 'realistic'
      ? null
      : roundUpToNiceLimit({
          amount: percentile({ values: finished.map((period) => period.spent), share: SUGGESTION_COVERAGE }),
        });

  return { periods: finished, overCount, averageUsage, verdict, suggestedLimit };
};
