/** Expenses minus income: what the budget actually cost. Negative when more came in than went out. */
export const getNetSpend = ({ expense, income }: { expense: number; income: number }): number => expense - income;

/**
 * What's left of `limit` after `netSpend`, or null without a limit. Negative once the
 * limit is exceeded (the amount over). Net inflow doesn't add to the limit.
 */
export const getLimitLeft = ({
  limit,
  netSpend,
}: {
  limit: number | null | undefined;
  netSpend: number;
}): number | null => (limit === null || limit === undefined ? null : limit - Math.max(0, netSpend));
