import { BUDGET_TYPES, TRANSACTION_TYPES } from '@bt/shared/types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import Budgets from '@models/budget.model';
import Categories from '@models/categories.model';
import TransactionSplits from '@models/transaction-splits.model';
import { findTransactions } from '@models/transactions-query';
import { Op } from 'sequelize';

import { authorizeBudgetRead } from './authorize-budget-access';
import { resolveBudgetWindow } from './utils/budget-window';
import {
  type BudgetEntry,
  type BudgetEntrySource,
  collectBudgetEntries,
  loadExcludedTransactionIds,
} from './utils/collect-budget-entries';

interface CategoryRef {
  id: string;
  name: string;
  color: string;
}

interface TransactionWithCategory {
  id: string;
  time: Date;
  transactionType: TRANSACTION_TYPES;
  refAmount: number;
  amount: number;
  note: string | null;
  categoryId: string | null;
  accountId: string;
  /** For split transactions, this is the split's category */
  effectiveCategory?: CategoryRef;
  /** For split transactions, this is the split amount */
  effectiveRefAmount?: number;
  /** Matched by the budget's categories, or linked by hand. */
  source: BudgetEntrySource;
}

interface ExcludedTransaction {
  id: string;
  time: Date;
  transactionType: TRANSACTION_TYPES;
  refAmount: number;
  note: string | null;
  accountId: string;
  category?: CategoryRef;
}

interface GetCategoryBudgetTransactionsParams {
  userId: number;
  budgetId: string;
  from?: number;
  limit?: number;
  /** Recurring budgets list the period containing this instant (default now). */
  at?: Date;
}

/**
 * Transactions a category budget counts, newest first: the category matches (a split
 * transaction as one row per matching split) and the transactions linked by hand. Also
 * returns the transactions excluded by hand within the same window, so they can be put
 * back.
 */
export const getCategoryBudgetTransactions = async ({
  userId,
  budgetId,
  from = 0,
  limit = 50,
  at,
}: GetCategoryBudgetTransactionsParams) => {
  // Share-aware auth: recipient sees owner's transactions on the budget (per PRD
  // visibility decision), not a recipient-userId slice.
  const { ownerUserId, isOwner } = await authorizeBudgetRead({ userId, budgetId });

  const budget = await findOrThrowNotFound({
    query: Budgets.findByPk(budgetId, {
      include: [{ model: Categories, as: 'categories', attributes: ['id', 'name', 'color'] }],
    }),
    message: t({ key: 'budgets.budgetNotFound' }),
  });

  if (budget.type !== BUDGET_TYPES.category) {
    throw new ValidationError({ message: t({ key: 'budgets.notCategoryBudget' }) });
  }

  const window = resolveBudgetWindow({ budget, at });
  const [{ entries }, excludedIds] = await Promise.all([
    collectBudgetEntries({ budget, ownerUserId, callerUserId: userId, isOwner, from: window.from, to: window.to }),
    loadExcludedTransactionIds({ budgetId }),
  ]);

  const sorted = entries.toSorted((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  const page = sorted.slice(from, from + limit);

  const [transactions, excluded] = await Promise.all([
    hydrateEntries({ entries: page }),
    loadExcludedTransactions({ excludedIds: [...excludedIds], window }),
  ]);

  return { transactions, total: sorted.length, excluded };
};

const loadCategories = async ({ ids }: { ids: string[] }) => {
  if (!ids.length) return new Map<string, CategoryRef>();
  const categories = await Categories.findAll({
    where: { id: { [Op.in]: ids } },
    attributes: ['id', 'name', 'color'],
  });
  return new Map<string, CategoryRef>(categories.map((c) => [c.id, { id: c.id, name: c.name, color: c.color }]));
};

/**
 * Turns counted entries into list rows. The ids come from `collectBudgetEntries`, which
 * already applied the budget's visibility rules, so the lookup itself is unscoped.
 */
const hydrateEntries = async ({ entries }: { entries: BudgetEntry[] }): Promise<TransactionWithCategory[]> => {
  if (!entries.length) return [];

  const transactionIds = [...new Set(entries.map((e) => e.transactionId))];
  const splitIds = entries.map((e) => e.splitId).filter((id): id is string => id !== null);

  const [transactions, splits, categories] = await Promise.all([
    findTransactions({
      planned: 'include',
      access: 'unscoped-internal',
      balanceAdjustments: 'include',
      completeness: 'all',
      where: { id: { [Op.in]: transactionIds } },
      attributes: ['id', 'time', 'transactionType', 'refAmount', 'amount', 'note', 'categoryId', 'accountId'],
    }),
    splitIds.length
      ? TransactionSplits.findAll({ where: { id: { [Op.in]: splitIds } }, attributes: ['id', 'amount', 'refAmount'] })
      : Promise.resolve([] as TransactionSplits[]),
    loadCategories({
      ids: [...new Set(entries.map((e) => e.categoryId).filter((id): id is NonNullable<typeof id> => id !== null))],
    }),
  ]);

  const txById = new Map<string, (typeof transactions)[number]>(transactions.map((tx) => [tx.id, tx]));
  const splitById = new Map<string, TransactionSplits>(splits.map((split) => [split.id, split]));

  return entries.flatMap((entry) => {
    const tx = txById.get(entry.transactionId);
    if (!tx) return [];
    const split = entry.splitId ? splitById.get(entry.splitId) : undefined;
    // Without a split the entry may still be partial: what the splits left on the
    // transaction's own category. Scale the original-currency amount the same way.
    const refAmount = split ? split.refAmount.toNumber() : entry.cents / 100;
    const txRefCents = tx.refAmount.toCents();
    const amount = split
      ? split.amount.toNumber()
      : txRefCents === entry.cents || txRefCents === 0
        ? tx.amount.toNumber()
        : Math.round((tx.amount.toNumber() * entry.cents * 100) / txRefCents) / 100;

    return [
      {
        id: tx.id,
        time: tx.time,
        transactionType: tx.transactionType,
        refAmount,
        amount,
        note: tx.note,
        categoryId: entry.categoryId,
        accountId: tx.accountId,
        effectiveCategory: entry.categoryId ? categories.get(entry.categoryId) : undefined,
        effectiveRefAmount: refAmount,
        source: entry.source,
      },
    ];
  });
};

const loadExcludedTransactions = async ({
  excludedIds,
  window,
}: {
  excludedIds: string[];
  window: { from: Date | null; to: Date | null };
}): Promise<ExcludedTransaction[]> => {
  if (!excludedIds.length) return [];

  const transactions = await findTransactions({
    planned: 'include',
    access: 'unscoped-internal',
    balanceAdjustments: 'include',
    completeness: 'all',
    where: {
      id: { [Op.in]: excludedIds },
      ...(window.from || window.to
        ? {
            time: {
              ...(window.from && { [Op.gte]: window.from }),
              ...(window.to && { [Op.lte]: window.to }),
            },
          }
        : {}),
    },
    attributes: ['id', 'time', 'transactionType', 'refAmount', 'note', 'categoryId', 'accountId'],
  });

  const categories = await loadCategories({
    ids: [...new Set(transactions.map((tx) => tx.categoryId).filter((id): id is NonNullable<typeof id> => !!id))],
  });

  return transactions
    .map((tx) => ({
      id: tx.id,
      time: tx.time,
      transactionType: tx.transactionType,
      refAmount: tx.refAmount.toNumber(),
      note: tx.note,
      accountId: tx.accountId,
      category: tx.categoryId ? categories.get(tx.categoryId) : undefined,
    }))
    .toSorted((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
};
