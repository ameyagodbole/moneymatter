import { Big, type BigSource } from 'big.js';

export interface SplitEvent {
  /** YYYY-MM-DD ex-date. */
  date: string;
  numerator: string;
  denominator: string;
}

/**
 * Product of the ratios of every split dated strictly after `date`: the factor
 * that turns a quantity traded on `date` into today's share basis. A trade on a
 * split's own date is already in post-split shares (the ex-date), so that split
 * doesn't apply to it.
 */
export function splitFactorAfter({ date, splits }: { date: string; splits: SplitEvent[] }): Big {
  return splits.reduce(
    (factor, split) => (split.date > date ? factor.times(split.numerator).div(split.denominator) : factor),
    new Big(1),
  );
}

/** A quantity traded on `date`, counted in today's share basis. */
export function toCurrentShareBasis({
  quantity,
  date,
  splits,
}: {
  quantity: BigSource;
  date: string;
  splits: SplitEvent[];
}): Big {
  return new Big(quantity).times(splitFactorAfter({ date, splits }));
}
