import { BUDGET_RECURRENCES, BUDGET_TYPES, type RecordId, TRANSACTION_TYPES } from '@bt/shared/types';
import { NONEXISTENT_ID } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';

/**
 * Hand overrides on category budgets: linking a transaction the categories don't
 * match, and excluding one they do.
 */

let categorySeq = 0;

const setUp = async () => {
  categorySeq += 1;
  const groceries = await helpers.addCustomCategory({ name: `Groceries ${categorySeq}`, color: '#FF0000', raw: true });
  const other = await helpers.addCustomCategory({ name: `Other ${categorySeq}`, color: '#00FF00', raw: true });
  const budget = await helpers.createCustomBudget({
    name: 'Groceries',
    type: BUDGET_TYPES.category,
    categoryIds: [groceries.id],
    raw: true,
  });
  const account = await helpers.createAccount({ raw: true });
  return { groceries, other, budget, account };
};

const createExpense = async ({
  accountId,
  categoryId,
  amount,
  time = '2025-10-05T12:00:00Z',
}: {
  accountId: RecordId;
  categoryId: RecordId;
  amount: number;
  time?: string;
}) => {
  const [tx] = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({
      accountId,
      categoryId,
      amount,
      time,
      transactionType: TRANSACTION_TYPES.expense,
    }),
    raw: true,
  });
  return tx!;
};

describe('Category budget overrides', () => {
  describe('linking by hand', () => {
    it('counts a linked transaction outside the categories and lists it as linked', async () => {
      const { groceries, other, budget, account } = await setUp();
      await createExpense({ accountId: account.id, categoryId: groceries.id, amount: 100 });
      const extra = await createExpense({ accountId: account.id, categoryId: other.id, amount: 30 });

      await helpers.addTransactionToCustomBudget({ id: budget.id, payload: { transactionIds: [extra.id] }, raw: true });

      const stats = await helpers.getStats({ id: budget.id, raw: true });
      expect(stats!.summary.actualExpense).toBe(130);
      expect(stats!.summary.transactionsCount).toBe(2);

      const list = await helpers.getCategoryBudgetTransactions({ id: budget.id, raw: true });
      expect(list.total).toBe(2);
      expect(list.transactions.find((tx) => tx.id === extra.id)!.source).toBe('linked');
      expect(list.transactions.find((tx) => tx.id !== extra.id)!.source).toBe('rule');
    });

    it('counts a linked transaction the categories already match only once', async () => {
      const { groceries, budget, account } = await setUp();
      const tx = await createExpense({ accountId: account.id, categoryId: groceries.id, amount: 100 });

      await helpers.addTransactionToCustomBudget({ id: budget.id, payload: { transactionIds: [tx.id] }, raw: true });

      const stats = await helpers.getStats({ id: budget.id, raw: true });
      expect(stats!.summary.actualExpense).toBe(100);
      expect(stats!.summary.transactionsCount).toBe(1);
    });

    it('accepts a transaction that is already linked', async () => {
      const { other, budget, account } = await setUp();
      const tx = await createExpense({ accountId: account.id, categoryId: other.id, amount: 30 });

      await helpers.addTransactionToCustomBudget({ id: budget.id, payload: { transactionIds: [tx.id] }, raw: true });
      const again = await helpers.addTransactionToCustomBudget({
        id: budget.id,
        payload: { transactionIds: [tx.id] },
        raw: false,
      });

      expect(again.statusCode).toBe(200);
    });

    it('shows linked transactions in the category breakdown under their own category', async () => {
      const { groceries, other, budget, account } = await setUp();
      await createExpense({ accountId: account.id, categoryId: groceries.id, amount: 100 });
      const extra = await createExpense({ accountId: account.id, categoryId: other.id, amount: 30 });
      await helpers.addTransactionToCustomBudget({ id: budget.id, payload: { transactionIds: [extra.id] }, raw: true });

      const spending = await helpers.getSpendingStats({ id: budget.id, raw: true });

      expect(spending.spendingsByCategory.map((c) => [c.categoryId, c.amount])).toEqual([
        [groceries.id, 100],
        [other.id, 30],
      ]);
    });
  });

  describe('POST /budgets/:id/excluded-transactions', () => {
    it('takes a matched transaction out of stats, breakdown and list, and lists it as excluded', async () => {
      const { groceries, budget, account } = await setUp();
      await createExpense({ accountId: account.id, categoryId: groceries.id, amount: 100 });
      const skipped = await createExpense({ accountId: account.id, categoryId: groceries.id, amount: 40 });

      await helpers.excludeTransactionsFromBudget({
        id: budget.id,
        payload: { transactionIds: [skipped.id] },
        raw: true,
      });

      const stats = await helpers.getStats({ id: budget.id, raw: true });
      expect(stats!.summary.actualExpense).toBe(100);

      const spending = await helpers.getSpendingStats({ id: budget.id, raw: true });
      expect(spending.spendingsByCategory[0]!.amount).toBe(100);

      const list = await helpers.getCategoryBudgetTransactions({ id: budget.id, raw: true });
      expect(list.transactions.map((tx) => tx.id)).not.toContain(skipped.id);
      expect(list.excluded.map((tx) => tx.id)).toEqual([skipped.id]);
    });

    it('excludes every split of a split transaction', async () => {
      const { groceries, budget, account } = await setUp();
      // $100 in groceries, $40 of it split off into a second groceries split.
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          categoryId: groceries.id,
          time: '2025-10-05T12:00:00Z',
          transactionType: TRANSACTION_TYPES.expense,
          splits: [{ amount: 40, categoryId: groceries.id }],
        }),
        raw: false,
      });
      const [splitTx] = await helpers.getTransactions({ raw: true, includeSplits: true });
      expect(splitTx!.splits).toHaveLength(1);
      const before = await helpers.getStats({ id: budget.id, raw: true });
      expect(before!.summary.actualExpense).toBe(100);

      await helpers.excludeTransactionsFromBudget({
        id: budget.id,
        payload: { transactionIds: [splitTx!.id] },
        raw: true,
      });

      const stats = await helpers.getStats({ id: budget.id, raw: true });
      expect(stats!.summary.actualExpense).toBe(0);
    });

    it('applies to period history too', async () => {
      const groceries = await helpers.addCustomCategory({ name: 'Monthly groceries', color: '#FF0000', raw: true });
      const budget = await helpers.createCustomBudget({
        name: 'Groceries',
        type: BUDGET_TYPES.category,
        categoryIds: [groceries.id],
        recurrence: BUDGET_RECURRENCES.monthly,
        startDate: '2025-01-01T00:00:00.000Z',
        raw: true,
      });
      const account = await helpers.createAccount({ raw: true });
      await createExpense({ accountId: account.id, categoryId: groceries.id, amount: 100 });
      const skipped = await createExpense({ accountId: account.id, categoryId: groceries.id, amount: 40 });

      await helpers.excludeTransactionsFromBudget({
        id: budget.id,
        payload: { transactionIds: [skipped.id] },
        raw: true,
      });

      const result = await helpers.getBudgetPeriods({
        id: budget.id,
        at: '2025-10-17T00:00:00.000Z',
        count: 1,
        raw: true,
      });
      expect(result.periods[0]!.spent).toBe(100);
    });

    it('drops a hand link to the transaction it excludes', async () => {
      const { other, budget, account } = await setUp();
      const tx = await createExpense({ accountId: account.id, categoryId: other.id, amount: 30 });
      await helpers.addTransactionToCustomBudget({ id: budget.id, payload: { transactionIds: [tx.id] }, raw: true });

      await helpers.excludeTransactionsFromBudget({ id: budget.id, payload: { transactionIds: [tx.id] }, raw: true });

      const stats = await helpers.getStats({ id: budget.id, raw: true });
      expect(stats!.summary.actualExpense).toBe(0);
    });

    it('rejects manual budgets', async () => {
      const budget = await helpers.createCustomBudget({ name: 'Manual', raw: true });
      const account = await helpers.createAccount({ raw: true });
      const [tx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id }),
        raw: true,
      });

      const response = await helpers.excludeTransactionsFromBudget({
        id: budget.id,
        payload: { transactionIds: [tx!.id] },
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('rejects unknown transaction ids', async () => {
      const { budget } = await setUp();

      const response = await helpers.excludeTransactionsFromBudget({
        id: budget.id,
        payload: { transactionIds: [NONEXISTENT_ID] },
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('returns 404 for an unknown budget', async () => {
      const response = await helpers.excludeTransactionsFromBudget({
        id: NONEXISTENT_ID,
        payload: { transactionIds: [NONEXISTENT_ID] },
      });

      expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
    });
  });

  describe('DELETE /budgets/:id/excluded-transactions', () => {
    it('puts an excluded transaction back', async () => {
      const { groceries, budget, account } = await setUp();
      const tx = await createExpense({ accountId: account.id, categoryId: groceries.id, amount: 40 });
      await helpers.excludeTransactionsFromBudget({ id: budget.id, payload: { transactionIds: [tx.id] }, raw: true });

      const result = await helpers.restoreExcludedTransactions({
        id: budget.id,
        payload: { transactionIds: [tx.id] },
        raw: true,
      });

      expect(result.restoredCount).toBe(1);
      const stats = await helpers.getStats({ id: budget.id, raw: true });
      expect(stats!.summary.actualExpense).toBe(40);
    });

    it('is also undone by linking the transaction by hand', async () => {
      const { groceries, budget, account } = await setUp();
      const tx = await createExpense({ accountId: account.id, categoryId: groceries.id, amount: 40 });
      await helpers.excludeTransactionsFromBudget({ id: budget.id, payload: { transactionIds: [tx.id] }, raw: true });

      await helpers.addTransactionToCustomBudget({ id: budget.id, payload: { transactionIds: [tx.id] }, raw: true });

      const list = await helpers.getCategoryBudgetTransactions({ id: budget.id, raw: true });
      expect(list.excluded).toEqual([]);
      expect(list.total).toBe(1);
    });

    it('returns 0 when nothing was excluded', async () => {
      const { groceries, budget, account } = await setUp();
      const tx = await createExpense({ accountId: account.id, categoryId: groceries.id, amount: 40 });

      const result = await helpers.restoreExcludedTransactions({
        id: budget.id,
        payload: { transactionIds: [tx.id] },
        raw: true,
      });

      expect(result.restoredCount).toBe(0);
    });
  });
});
