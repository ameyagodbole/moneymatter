import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import Budgets from '@models/budget.model';
import Categories from '@models/categories.model';

import { withTransaction } from '../common/with-transaction';
import { authorizeBudgetRead } from './authorize-budget-access';
import type { BudgetPeriod } from './utils/budget-periods';
import { resolveBudgetWindow } from './utils/budget-window';
import { type BudgetEntries, collectBudgetEntries } from './utils/collect-budget-entries';

interface StatsResponse {
  /** The period the totals cover, or null for one-off budgets. */
  period: BudgetPeriod | null;
  summary: {
    actualIncome: number;
    actualExpense: number;
    balance: number; // Net difference
    utilizationRate: null | number; // Percentage used (0-100)
    transactionsCount: number;
    firstTransactionDate: string | null; // ISO date string of earliest transaction
    lastTransactionDate: string | null; // ISO date string of latest transaction
  };
}

const getEmptySummary = (): StatsResponse['summary'] => ({
  actualIncome: 0,
  actualExpense: 0,
  balance: 0,
  utilizationRate: null,
  transactionsCount: 0,
  firstTransactionDate: null,
  lastTransactionDate: null,
});

/** Stats of a one-off budget with nothing counted. */
export const getResponseInitialState = (): StatsResponse => ({ period: null, summary: getEmptySummary() });

/** Spending measured against the limit: net outflow, never below zero. */
export const computeUtilizationRate = ({
  income,
  expense,
  limitAmount,
}: {
  income: number;
  expense: number;
  limitAmount: number | null;
}): number | null => (limitAmount === null ? null : (Math.max(0, expense - income) / limitAmount) * 100);

/**
 * Totals over collected entries. Refund legs are subtracted from the side they net, so a
 * refund-income doesn't inflate income and the matching expense reflects net spend.
 */
const summarizeEntries = ({
  entries,
  refundAdjustments,
  limitAmount,
}: BudgetEntries & { limitAmount: number | null }): StatsResponse['summary'] => {
  const summary = getEmptySummary();
  const transactionIds = new Set<string>();

  for (const entry of entries) {
    if (entry.isExpense) summary.actualExpense += entry.cents;
    else summary.actualIncome += entry.cents;

    transactionIds.add(entry.transactionId);

    const txDate = new Date(entry.time).toISOString();
    if (!summary.firstTransactionDate || txDate < summary.firstTransactionDate) summary.firstTransactionDate = txDate;
    if (!summary.lastTransactionDate || txDate > summary.lastTransactionDate) summary.lastTransactionDate = txDate;
  }

  for (const adjustment of refundAdjustments) {
    if (adjustment.isExpense) summary.actualExpense -= adjustment.cents;
    else summary.actualIncome -= adjustment.cents;
  }

  summary.transactionsCount = transactionIds.size;
  summary.balance = summary.actualIncome - summary.actualExpense;
  summary.utilizationRate = computeUtilizationRate({
    income: summary.actualIncome,
    expense: summary.actualExpense,
    limitAmount,
  });

  return summary;
};

/**
 * Income, expense and limit usage for a budget. Recurring budgets report the period
 * containing `at` (default now); one-off budgets report their whole scope.
 *
 * Share-aware: a recipient sees the same numbers the owner would. Category matches are
 * scoped to the owner's transactions; linked rows count whoever attached them, so a
 * `write` recipient's attached transactions contribute too.
 */
export const getBudgetStats = withTransaction(
  async ({ userId, budgetId, at }: { userId: number; budgetId: string; at?: Date }): Promise<StatsResponse> => {
    const { ownerUserId, isOwner } = await authorizeBudgetRead({ userId, budgetId });

    const budget = await findOrThrowNotFound({
      query: Budgets.findByPk(budgetId, {
        include: [{ model: Categories, as: 'categories', attributes: ['id'] }],
      }),
      message: t({ key: 'budgets.budgetNotFound' }),
    });

    const { from, to, period } = resolveBudgetWindow({ budget, at });

    const collected = await collectBudgetEntries({
      budget,
      ownerUserId,
      callerUserId: userId,
      isOwner,
      from,
      to,
    });

    return {
      period,
      summary: summarizeEntries({ ...collected, limitAmount: budget.limitAmount?.toCents() ?? null }),
    };
  },
);
