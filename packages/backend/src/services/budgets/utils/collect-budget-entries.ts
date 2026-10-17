import { BUDGET_TYPES, type BudgetRuleGroup, type RecordId, TRANSACTION_TYPES } from '@bt/shared/types';
import BudgetExcludedTransactions from '@models/budget-excluded-transactions.model';
import type Budgets from '@models/budget.model';
import TransactionSplits from '@models/transaction-splits.model';
import TransactionTags from '@models/transaction-tags.model';
import { PlannedPolicy } from '@models/transactions-query';
import * as Transactions from '@models/transactions.model';
import { statsTransactions } from '@services/stats/stats-transactions';
import { Op, type WhereOptions, literal } from 'sequelize';

import { getBudgetRuleGroups, matchRuleGroups } from './budget-rules';
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
 * - Automatic (`category`) budgets count the owner's transactions their rules match (see
 *   `matchRuleGroups` for how split transactions count), minus the ones excluded by hand,
 *   plus any transaction linked by hand that the rules didn't already count.
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
  budget: Pick<Budgets, 'id' | 'type' | 'rules'> & { categories?: { id: string }[] };
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
      collectRuleEntries({
        groups: getBudgetRuleGroups({
          rules: budget.rules,
          categoryIds: (budget.categories ?? []).map((c) => c.id as RecordId),
        }),
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

/** `"col" IN (SELECT "transactionId" FROM <table> WHERE <column> IN (...))`, with escaped ids. */
const escapeSql = (value: string) => TransactionSplits.sequelize!.escape(value);

const transactionIdsWhere = ({ table, column, ids }: { table: string; column: string; ids: string[] }) => ({
  id: {
    [Op.in]: literal(
      `(SELECT "transactionId" FROM "${table}" WHERE "${column}" IN (${ids.map(escapeSql).join(', ')}))`,
    ),
  },
});

/**
 * SQL a transaction must pass for a rule to have a chance at it. It is exact except for
 * `tagMatch: 'all'` (checked as "any" here) and which parts count; `matchRuleGroups`
 * settles both on the loaded rows.
 */
const ruleGroupWhere = ({ group }: { group: BudgetRuleGroup }): WhereOptions => ({
  [Op.and]: [
    ...(group.categoryIds.length
      ? [
          {
            [Op.or]: [
              { categoryId: { [Op.in]: group.categoryIds } },
              transactionIdsWhere({ table: 'TransactionSplits', column: 'categoryId', ids: group.categoryIds }),
            ],
          },
        ]
      : []),
    ...(group.accountIds.length ? [{ accountId: { [Op.in]: group.accountIds } }] : []),
    ...(group.payeeIds.length ? [{ payeeId: { [Op.in]: group.payeeIds } }] : []),
    ...(group.tagIds.length
      ? [transactionIdsWhere({ table: 'TransactionTags', column: 'tagId', ids: group.tagIds })]
      : []),
  ],
});

/**
 * The owner's transactions an automatic budget's rules match, as one entry per counted
 * part: the remainder on the transaction's own category, and each matching split.
 */
const collectRuleEntries = async ({
  groups,
  ownerUserId,
  isOwner,
  from,
  to,
}: {
  groups: BudgetRuleGroup[];
  ownerUserId: number;
  isOwner: boolean;
  from: Date | null;
  to: Date | null;
}): Promise<CountedEntries> => {
  if (!groups.length) return { entries: [], countedTransactions: [] };

  // Planned rows are owner-only: they count as spent for the owner, but a share
  // recipient must never see them.
  const planned: PlannedPolicy = isOwner ? 'include' : 'exclude';

  const { rows: candidates } = await statsTransactions({
    access: { creator: ownerUserId },
    planned,
    refunds: 'ignore',
    window: { from: from ?? undefined, to: to ?? undefined },
    where: { [Op.or]: groups.map((group) => ruleGroupWhere({ group })) },
    attributes: ['id', 'time', 'refAmount', 'transactionType', 'refundLinked', 'categoryId', 'accountId', 'payeeId'],
  });

  if (!candidates.length) return { entries: [], countedTransactions: [] };

  const candidateIds = candidates.map((tx) => tx.id);
  const [splits, tags] = await Promise.all([
    TransactionSplits.findAll({
      where: { transactionId: { [Op.in]: candidateIds } },
      attributes: ['id', 'transactionId', 'categoryId', 'refAmount'],
    }),
    TransactionTags.findAll({
      where: { transactionId: { [Op.in]: candidateIds } },
      attributes: ['transactionId', 'tagId'],
    }),
  ]);

  const splitsByTx = new Map<string, TransactionSplits[]>();
  for (const split of splits)
    splitsByTx.set(split.transactionId, [...(splitsByTx.get(split.transactionId) ?? []), split]);
  const tagsByTx = new Map<string, Set<string>>();
  for (const tag of tags)
    tagsByTx.set(tag.transactionId, (tagsByTx.get(tag.transactionId) ?? new Set()).add(tag.tagId));

  const entries: BudgetEntry[] = [];
  const countedTransactions: { id: string; refundLinked: boolean }[] = [];

  for (const tx of candidates) {
    const txSplits = splitsByTx.get(tx.id) ?? [];
    const cents = tx.refAmount.toCents();
    const match = matchRuleGroups({
      groups,
      tx: {
        categoryId: tx.categoryId,
        accountId: tx.accountId,
        payeeId: tx.payeeId,
        tagIds: tagsByTx.get(tx.id) ?? new Set(),
        cents,
        splits: txSplits.map((split) => ({
          id: split.id,
          categoryId: split.categoryId,
          cents: split.refAmount.toCents(),
        })),
      },
    });
    if (!match) continue;

    const isExpense = tx.transactionType === TRANSACTION_TYPES.expense;

    if (match.remainder) {
      const splitsCents = txSplits.reduce((sum, split) => sum + split.refAmount.toCents(), 0);
      entries.push({
        transactionId: tx.id,
        splitId: null,
        time: tx.time,
        cents: cents - splitsCents,
        isExpense,
        categoryId: tx.categoryId,
        source: 'rule',
      });
    }
    for (const split of txSplits) {
      if (!match.splitIds.has(split.id)) continue;
      entries.push({
        transactionId: tx.id,
        splitId: split.id,
        time: tx.time,
        cents: split.refAmount.toCents(),
        isExpense,
        categoryId: split.categoryId,
        source: 'rule',
      });
    }
    countedTransactions.push({ id: tx.id, refundLinked: tx.refundLinked });
  }

  return { entries, countedTransactions };
};
