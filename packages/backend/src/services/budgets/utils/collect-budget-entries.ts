import { BUDGET_TYPES, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import Accounts from '@models/accounts.model';
import type Budgets from '@models/budget.model';
import TransactionSplits from '@models/transaction-splits.model';
import { PlannedPolicy, transactionsInclude } from '@models/transactions-query';
import * as Transactions from '@models/transactions.model';
import { statsTransactions } from '@services/stats/stats-transactions';
import { Op } from 'sequelize';

import { buildDateFilter } from './build-date-filter';
import { fetchBudgetRefundPairs } from './refund-pairs';

/** One amount counted towards a budget: a whole transaction, or the matching split of one. */
export interface BudgetEntry {
  transactionId: string;
  time: Date;
  /** Base-currency cents, always positive. */
  cents: number;
  isExpense: boolean;
}

/** A refund leg to subtract, dated at the counted side it nets out. */
export interface BudgetRefundAdjustment {
  time: Date;
  cents: number;
  isExpense: boolean;
}

export interface BudgetEntries {
  entries: BudgetEntry[];
  refundAdjustments: BudgetRefundAdjustment[];
}

/**
 * Every amount a budget counts within `[from, to]`, plus the refund legs that net
 * against them.
 *
 * - Manual budgets read the `BudgetTransactions` junction with no userId filter, so a
 *   `write` recipient's attached rows count. Planned rows only count for the caller.
 * - Category budgets read the owner's transactions whose category matches, counting a
 *   split transaction only by its matching splits. Planned rows count for the owner only.
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
  const counted =
    budget.type === BUDGET_TYPES.category
      ? await collectCategoryEntries({
          categoryIds: budget.categories?.map((c) => c.id) ?? [],
          ownerUserId,
          isOwner,
          from,
          to,
        })
      : await collectManualEntries({ budgetId: budget.id, callerUserId, from, to });

  const refundAdjustments: BudgetRefundAdjustment[] = [];
  const pairs = await fetchBudgetRefundPairs({ countedTransactions: counted.countedTransactions });

  for (const pair of pairs) {
    const cents = pair.refundTx.refAmount.toCents();
    if (pair.originalInScope) {
      refundAdjustments.push({
        time: pair.originalTx.time,
        cents,
        isExpense: pair.originalTx.transactionType === TRANSACTION_TYPES.expense,
      });
    }
    if (pair.refundInScope) {
      refundAdjustments.push({
        time: pair.refundTx.time,
        cents,
        isExpense: pair.refundTx.transactionType === TRANSACTION_TYPES.expense,
      });
    }
  }

  return { entries: counted.entries, refundAdjustments };
};

interface CountedEntries {
  entries: BudgetEntry[];
  countedTransactions: { id: string; refundLinked: boolean }[];
}

const collectManualEntries = async ({
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
  const transactions: Pick<Transactions.default, 'id' | 'time' | 'refAmount' | 'transactionType' | 'refundLinked'>[] =
    await Transactions.findWithFilters({
      excludeTransfer: true,
      budgetIds: [budgetId],
      completeness: 'all',
      planned: { visibleTo: callerUserId },
      access: 'pre-scoped',
      balanceAdjustments: 'include',
      ...(from && { startDate: from.toISOString() }),
      ...(to && { endDate: to.toISOString() }),
      attributes: ['id', 'time', 'refAmount', 'transactionType', 'refundLinked'],
    });

  return {
    entries: transactions.map((tx) => ({
      transactionId: tx.id,
      time: tx.time,
      cents: tx.refAmount.toCents(),
      isExpense: tx.transactionType === TRANSACTION_TYPES.expense,
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

  // A transaction with splits is counted through its matching splits below, never whole.
  for (const tx of primaryCategoryTransactions) {
    const splits = tx.get('splits') as TransactionSplits[] | undefined;
    if (splits && splits.length > 0) continue;

    entries.push({
      transactionId: tx.id,
      time: tx.time,
      cents: tx.refAmount.toCents(),
      isExpense: tx.transactionType === TRANSACTION_TYPES.expense,
    });
    countedTransactions.push({ id: tx.id, refundLinked: tx.refundLinked });
  }

  for (const split of matchingSplits) {
    const transaction = split.get('transaction') as Transactions.default;
    if (!transaction) continue;

    entries.push({
      transactionId: transaction.id,
      time: transaction.time,
      cents: split.refAmount.toCents(),
      isExpense: transaction.transactionType === TRANSACTION_TYPES.expense,
    });
    countedTransactions.push({ id: transaction.id, refundLinked: transaction.refundLinked });
  }

  return { entries, countedTransactions };
};
