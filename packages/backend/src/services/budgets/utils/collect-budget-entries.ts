import { BUDGET_TYPES, type RecordId, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import Accounts from '@models/accounts.model';
import BudgetExcludedTransactions from '@models/budget-excluded-transactions.model';
import type Budgets from '@models/budget.model';
import TransactionSplits from '@models/transaction-splits.model';
import { PlannedPolicy, transactionsInclude } from '@models/transactions-query';
import * as Transactions from '@models/transactions.model';
import { statsTransactions } from '@services/stats/stats-transactions';
import { Op } from 'sequelize';

import { buildDateFilter } from './build-date-filter';
import { fetchBudgetRefundPairs } from './refund-pairs';

/**
 * Why an amount counts towards a budget: matched by the budget's categories, or linked
 * by hand (every amount of a manual budget; extra transactions on a category budget).
 */
export type BudgetEntrySource = 'rule' | 'linked';

/** One amount counted towards a budget: a whole transaction, or the matching split of one. */
export interface BudgetEntry {
  transactionId: string;
  /** Set when only this split of the transaction counts. */
  splitId: string | null;
  time: Date;
  /** Base-currency cents, always positive. */
  cents: number;
  isExpense: boolean;
  /** Category of the counted amount: the split's category for a split, else the transaction's. */
  categoryId: RecordId | null;
  source: BudgetEntrySource;
}

/** A refund leg to subtract, dated at the counted side it nets out. */
export interface BudgetRefundAdjustment {
  time: Date;
  cents: number;
  isExpense: boolean;
  /** Category the refunded amount was counted under, for per-category breakdowns. */
  categoryId: RecordId | null;
}

export interface BudgetEntries {
  entries: BudgetEntry[];
  refundAdjustments: BudgetRefundAdjustment[];
}

/**
 * Every amount a budget counts within `[from, to]`, plus the refund legs that net
 * against them. This is the single definition of a budget's scope; stats, spending
 * breakdowns, period history and the transaction list all read from it.
 *
 * - Manual budgets count the transactions linked through `BudgetTransactions`, with no
 *   userId filter, so a `write` recipient's attached rows count.
 * - Category budgets count the owner's transactions whose category matches (a split
 *   transaction only by its matching splits), minus the ones excluded by hand, plus any
 *   transaction linked by hand that the categories didn't already count.
 *
 * Planned rows count for the owner only on matched amounts, and for the caller only on
 * linked ones, so a recipient never sees the owner's plans.
 *
 * Refunds: for each refund pair with a side in scope, that side's total is reduced by the
 * refund amount (matching the global "Expenses Structure" widget). The adjustment is dated
 * at the counted side, so bucketing entries and adjustments by time gives the same result
 * as collecting each bucket separately.
 */
export const collectBudgetEntries = async ({
  budget,
  ownerUserId,
  callerUserId,
  isOwner,
  from,
  to,
}: {
  budget: Pick<Budgets, 'id' | 'type'> & { categories?: { id: string }[] };
  ownerUserId: number;
  callerUserId: number;
  isOwner: boolean;
  from: Date | null;
  to: Date | null;
}): Promise<BudgetEntries> => {
  const linked = await collectLinkedEntries({ budgetId: budget.id, callerUserId, from, to });

  let entries = linked.entries;
  let countedTransactions = linked.countedTransactions;

  if (budget.type === BUDGET_TYPES.category) {
    const [matched, excludedIds] = await Promise.all([
      collectCategoryEntries({
        categoryIds: budget.categories?.map((c) => c.id) ?? [],
        ownerUserId,
        isOwner,
        from,
        to,
      }),
      loadExcludedTransactionIds({ budgetId: budget.id }),
    ]);

    const keptMatched = matched.entries.filter((entry) => !excludedIds.has(entry.transactionId));
    const matchedIds = new Set(keptMatched.map((entry) => entry.transactionId));
    // A hand-linked transaction the categories already count stays counted once, by its matching parts.
    const extraLinked = linked.entries.filter((entry) => !matchedIds.has(entry.transactionId));

    entries = [...keptMatched, ...extraLinked];
    countedTransactions = dedupeCounted([
      ...matched.countedTransactions.filter((tx) => !excludedIds.has(tx.id)),
      ...linked.countedTransactions.filter((tx) => !matchedIds.has(tx.id)),
    ]);
  }

  const refundAdjustments: BudgetRefundAdjustment[] = [];
  const pairs = await fetchBudgetRefundPairs({ countedTransactions });

  for (const pair of pairs) {
    const cents = pair.refundTx.refAmount.toCents();
    if (pair.originalInScope) {
      refundAdjustments.push({
        time: pair.originalTx.time,
        cents,
        isExpense: pair.originalTx.transactionType === TRANSACTION_TYPES.expense,
        categoryId: pair.splitCategoryId ?? pair.originalTx.categoryId,
      });
    }
    if (pair.refundInScope) {
      refundAdjustments.push({
        time: pair.refundTx.time,
        cents,
        isExpense: pair.refundTx.transactionType === TRANSACTION_TYPES.expense,
        categoryId: pair.refundTx.categoryId,
      });
    }
  }

  return { entries, refundAdjustments };
};

/** Ids of transactions excluded by hand from a category budget. */
export const loadExcludedTransactionIds = async ({ budgetId }: { budgetId: string }): Promise<Set<string>> => {
  const rows = await BudgetExcludedTransactions.findAll({ where: { budgetId }, attributes: ['transactionId'] });
  return new Set(rows.map((row) => row.transactionId));
};

interface CountedEntries {
  entries: BudgetEntry[];
  countedTransactions: { id: string; refundLinked: boolean }[];
}

const dedupeCounted = (rows: CountedEntries['countedTransactions']) => {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return [...byId.values()];
};

const collectLinkedEntries = async ({
  budgetId,
  callerUserId,
  from,
  to,
}: {
  budgetId: string;
  callerUserId: number;
  from: Date | null;
  to: Date | null;
}): Promise<CountedEntries> => {
  const transactions: Pick<
    Transactions.default,
    'id' | 'time' | 'refAmount' | 'transactionType' | 'refundLinked' | 'categoryId'
  >[] = await Transactions.findWithFilters({
    excludeTransfer: true,
    budgetIds: [budgetId],
    completeness: 'all',
    planned: { visibleTo: callerUserId },
    access: 'pre-scoped',
    balanceAdjustments: 'include',
    ...(from && { startDate: from.toISOString() }),
    ...(to && { endDate: to.toISOString() }),
    attributes: ['id', 'time', 'refAmount', 'transactionType', 'refundLinked', 'categoryId'],
  });

  return {
    entries: transactions.map((tx) => ({
      transactionId: tx.id,
      splitId: null,
      time: tx.time,
      cents: tx.refAmount.toCents(),
      isExpense: tx.transactionType === TRANSACTION_TYPES.expense,
      categoryId: tx.categoryId,
      source: 'linked',
    })),
    countedTransactions: transactions.map((tx) => ({ id: tx.id, refundLinked: tx.refundLinked })),
  };
};

const collectCategoryEntries = async ({
  categoryIds,
  ownerUserId,
  isOwner,
  from,
  to,
}: {
  categoryIds: string[];
  ownerUserId: number;
  isOwner: boolean;
  from: Date | null;
  to: Date | null;
}): Promise<CountedEntries> => {
  if (!categoryIds.length) return { entries: [], countedTransactions: [] };

  // Planned rows are owner-only: they count as spent for the owner, but a share
  // recipient must never see them.
  const planned: PlannedPolicy = isOwner ? 'include' : 'exclude';

  const [{ rows: primaryCategoryTransactions }, matchingSplits] = await Promise.all([
    statsTransactions({
      access: { creator: ownerUserId },
      planned,
      refunds: 'ignore',
      window: { from: from ?? undefined, to: to ?? undefined },
      where: { categoryId: { [Op.in]: categoryIds } },
      include: [{ model: TransactionSplits, as: 'splits', required: false }],
    }),
    TransactionSplits.findAll({
      where: {
        userId: ownerUserId,
        categoryId: { [Op.in]: categoryIds },
      },
      include: [
        transactionsInclude({
          planned,
          required: true,
          as: 'transaction',
          where: {
            transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
            ...buildDateFilter({ startDate: from, endDate: to }),
          },
          attributes: ['id', 'time', 'transactionType', 'refundLinked'],
          include: [{ model: Accounts, where: { excludeFromStats: false }, attributes: [] }],
        }),
      ],
    }),
  ]);

  const entries: BudgetEntry[] = [];
  const countedTransactions: { id: string; refundLinked: boolean }[] = [];

  // A transaction whose own category matches counts what its splits leave on that category:
  // the whole amount when it has no splits, the remainder when it does (as the global stats
  // allocate it). Matching splits are counted on their own below.
  for (const tx of primaryCategoryTransactions) {
    const splits = (tx.get('splits') as TransactionSplits[] | undefined) ?? [];
    const splitsCents = splits.reduce((sum, split) => sum + split.refAmount.toCents(), 0);
    const remainderCents = tx.refAmount.toCents() - splitsCents;
    if (remainderCents <= 0) continue;

    entries.push({
      transactionId: tx.id,
      splitId: null,
      time: tx.time,
      cents: remainderCents,
      isExpense: tx.transactionType === TRANSACTION_TYPES.expense,
      categoryId: tx.categoryId,
      source: 'rule',
    });
    countedTransactions.push({ id: tx.id, refundLinked: tx.refundLinked });
  }

  for (const split of matchingSplits) {
    const transaction = split.get('transaction') as Transactions.default;
    if (!transaction) continue;

    entries.push({
      transactionId: transaction.id,
      splitId: split.id,
      time: transaction.time,
      cents: split.refAmount.toCents(),
      isExpense: transaction.transactionType === TRANSACTION_TYPES.expense,
      categoryId: split.categoryId,
      source: 'rule',
    });
    countedTransactions.push({ id: transaction.id, refundLinked: transaction.refundLinked });
  }

  return { entries, countedTransactions: dedupeCounted(countedTransactions) };
};
