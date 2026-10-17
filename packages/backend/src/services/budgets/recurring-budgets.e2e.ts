import { BUDGET_RECURRENCES, BUDGET_TYPES, type RecordId, TRANSACTION_TYPES } from '@bt/shared/types';
import { NONEXISTENT_ID } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';

const createExpense = async ({
  accountId,
  amount,
  time,
  categoryId,
  transactionType = TRANSACTION_TYPES.expense,
}: {
  accountId: RecordId;
  amount: number;
  time: string;
  categoryId?: RecordId;
  transactionType?: TRANSACTION_TYPES;
}) => {
  const [tx] = await helpers.createTransaction({
    // Leave categoryId out when unset so the payload keeps its default category.
    payload: helpers.buildTransactionPayload({
      accountId,
      amount,
      time,
      transactionType,
      ...(categoryId && { categoryId }),
    }),
    raw: true,
  });
  return tx!;
};

let categorySeq = 0;

const createGroceriesBudget = async (
  overrides: Omit<Partial<Parameters<typeof helpers.createCustomBudget>[0]>, 'raw'> = {},
) => {
  categorySeq += 1;
  const category = await helpers.addCustomCategory({ name: `Groceries ${categorySeq}`, color: '#FF0000', raw: true });
  const budget = await helpers.createCustomBudget({
    name: 'Groceries',
    type: BUDGET_TYPES.category,
    categoryIds: [category.id],
    recurrence: BUDGET_RECURRENCES.monthly,
    startDate: '2025-01-01T00:00:00.000Z',
    limitAmount: 500,
    raw: true,
    ...overrides,
  });
  return { category, budget };
};

/**
 * Recurring budgets: monthly/quarterly/yearly periods computed from the start date's
 * calendar day in the budget's timezone. Every read takes an explicit `at` so the
 * results never depend on when the suite runs.
 */
describe('Recurring budgets', () => {
  describe('POST /budgets', () => {
    it('creates a monthly budget that repeats until archived', async () => {
      const { budget } = await createGroceriesBudget();

      expect(budget.recurrence).toBe(BUDGET_RECURRENCES.monthly);
      expect(budget.endDate).toBeNull();
    });

    it('moves the start to local midnight of its day in the budget timezone', async () => {
      // 13:00 UTC on Jan 25 is Jan 25 in Kyiv (UTC+2): the series starts at Kyiv midnight.
      const { budget } = await createGroceriesBudget({
        timezone: 'Europe/Kyiv',
        startDate: '2025-01-25T13:00:00.000Z',
      });

      expect(budget.timezone).toBe('Europe/Kyiv');
      expect(new Date(budget.startDate!).toISOString()).toBe('2025-01-24T22:00:00.000Z');
    });

    it('snaps the end date to the end of the period containing it', async () => {
      const { budget } = await createGroceriesBudget({
        startDate: '2025-01-25T00:00:00.000Z',
        endDate: '2025-06-03T00:00:00.000Z',
      });

      expect(new Date(budget.endDate!).toISOString()).toBe('2025-06-24T23:59:59.999Z');
    });

    it('keeps one-off budgets as they were', async () => {
      const budget = await helpers.createCustomBudget({ name: 'Trip', raw: true });

      expect(budget.recurrence).toBe(BUDGET_RECURRENCES.none);
      expect(budget.startDate).toBeNull();
    });

    it('rejects a recurring budget without a start date', async () => {
      const response = await helpers.createCustomBudget({
        name: 'Groceries',
        recurrence: BUDGET_RECURRENCES.monthly,
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('rejects an unknown timezone', async () => {
      const response = await helpers.createCustomBudget({
        name: 'Groceries',
        recurrence: BUDGET_RECURRENCES.monthly,
        startDate: '2025-01-01T00:00:00.000Z',
        timezone: 'Mars/Olympus_Mons',
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });

  describe('PUT /budgets/:id', () => {
    it('normalises the stored dates when a one-off budget becomes recurring', async () => {
      const budget = await helpers.createCustomBudget({
        name: 'Groceries',
        startDate: '2025-03-10T15:00:00.000Z',
        endDate: '2025-05-20T00:00:00.000Z',
        raw: true,
      });

      const updated = await helpers.editCustomBudget({
        id: budget.id,
        params: { recurrence: BUDGET_RECURRENCES.monthly },
        raw: true,
      });

      expect(updated.recurrence).toBe(BUDGET_RECURRENCES.monthly);
      expect(new Date(updated.startDate!).toISOString()).toBe('2025-03-10T00:00:00.000Z');
      expect(new Date(updated.endDate!).toISOString()).toBe('2025-06-09T23:59:59.999Z');
    });

    it('clears the end date with null', async () => {
      const { budget } = await createGroceriesBudget({ endDate: '2025-12-31T00:00:00.000Z' });

      const updated = await helpers.editCustomBudget({ id: budget.id, params: { endDate: null }, raw: true });

      expect(updated.endDate).toBeNull();
    });

    it('rejects switching to recurring when the budget has no start date', async () => {
      const budget = await helpers.createCustomBudget({ name: 'Groceries', raw: true });

      const response = await helpers.editCustomBudget({
        id: budget.id,
        params: { recurrence: BUDGET_RECURRENCES.monthly },
        raw: false,
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });

  describe('GET /budgets/:id/stats', () => {
    it('reports only the period containing `at` for a category budget', async () => {
      const { category, budget } = await createGroceriesBudget();
      const account = await helpers.createAccount({ raw: true });

      await createExpense({
        accountId: account.id,
        amount: 100,
        time: '2025-09-15T12:00:00Z',
        categoryId: category.id,
      });
      await createExpense({ accountId: account.id, amount: 40, time: '2025-10-02T12:00:00Z', categoryId: category.id });
      await createExpense({ accountId: account.id, amount: 60, time: '2025-10-30T12:00:00Z', categoryId: category.id });

      const stats = await helpers.getStats({ id: budget.id, at: '2025-10-17T00:00:00.000Z', raw: true });

      expect(stats!.summary.actualExpense).toBe(100);
      expect(stats!.summary.transactionsCount).toBe(2);
      expect(stats!.summary.utilizationRate).toBeCloseTo(20, 5);
      expect(stats!.period).toEqual({
        index: 9,
        start: '2025-10-01T00:00:00.000Z',
        end: '2025-10-31T23:59:59.999Z',
      });
    });

    it('reports only the period containing `at` for a manual budget', async () => {
      const budget = await helpers.createCustomBudget({
        name: 'Household',
        recurrence: BUDGET_RECURRENCES.monthly,
        startDate: '2025-01-01T00:00:00.000Z',
        limitAmount: 200,
        raw: true,
      });
      const account = await helpers.createAccount({ raw: true });

      const september = await createExpense({ accountId: account.id, amount: 70, time: '2025-09-10T12:00:00Z' });
      const october = await createExpense({ accountId: account.id, amount: 30, time: '2025-10-10T12:00:00Z' });
      await helpers.addTransactionToCustomBudget({
        id: budget.id,
        payload: { transactionIds: [september.id, october.id] },
        raw: true,
      });

      const stats = await helpers.getStats({ id: budget.id, at: '2025-09-20T00:00:00.000Z', raw: true });

      expect(stats!.summary.actualExpense).toBe(70);
      expect(stats!.summary.transactionsCount).toBe(1);
    });

    it('reports the last period once the series has ended', async () => {
      const { category, budget } = await createGroceriesBudget({ endDate: '2025-03-31T00:00:00.000Z' });
      const account = await helpers.createAccount({ raw: true });
      await createExpense({ accountId: account.id, amount: 25, time: '2025-03-05T12:00:00Z', categoryId: category.id });

      const stats = await helpers.getStats({ id: budget.id, at: '2026-06-01T00:00:00.000Z', raw: true });

      expect(stats!.period!.index).toBe(2);
      expect(stats!.summary.actualExpense).toBe(25);
    });

    it('returns no period for a one-off budget', async () => {
      const budget = await helpers.createCustomBudget({ name: 'Trip', raw: true });

      const stats = await helpers.getStats({ id: budget.id, raw: true });

      expect(stats!.period).toBeNull();
    });
  });

  describe('GET /budgets/:id/spending-stats and /category-transactions', () => {
    it('limit the breakdown and the transaction list to the selected period', async () => {
      const { category, budget } = await createGroceriesBudget();
      const account = await helpers.createAccount({ raw: true });

      await createExpense({
        accountId: account.id,
        amount: 100,
        time: '2025-09-15T12:00:00Z',
        categoryId: category.id,
      });
      await createExpense({ accountId: account.id, amount: 40, time: '2025-10-02T12:00:00Z', categoryId: category.id });

      const spending = await helpers.getSpendingStats({ id: budget.id, at: '2025-10-17T00:00:00.000Z', raw: true });
      expect(spending.spendingsByCategory).toHaveLength(1);
      expect(spending.spendingsByCategory[0]!.amount).toBe(40);
      expect(spending.spendingOverTime.periods[0]!.periodStart).toBe('2025-10-01');

      const list = await helpers.getCategoryBudgetTransactions({
        id: budget.id,
        at: '2025-09-17T00:00:00.000Z',
        raw: true,
      });
      expect(list.total).toBe(1);
      expect(list.transactions[0]!.refAmount).toBe(100);
    });
  });

  describe('GET /budgets/:id/periods', () => {
    it('returns per-period totals against the limit, oldest first', async () => {
      const { category, budget } = await createGroceriesBudget();
      const account = await helpers.createAccount({ raw: true });

      await createExpense({
        accountId: account.id,
        amount: 600,
        time: '2025-08-20T12:00:00Z',
        categoryId: category.id,
      });
      await createExpense({
        accountId: account.id,
        amount: 100,
        time: '2025-09-15T12:00:00Z',
        categoryId: category.id,
      });
      await createExpense({ accountId: account.id, amount: 40, time: '2025-10-02T12:00:00Z', categoryId: category.id });
      await createExpense({ accountId: account.id, amount: 60, time: '2025-10-03T12:00:00Z', categoryId: category.id });

      const result = await helpers.getBudgetPeriods({
        id: budget.id,
        at: '2025-10-17T00:00:00.000Z',
        count: 3,
        raw: true,
      });

      expect(result.recurrence).toBe(BUDGET_RECURRENCES.monthly);
      expect(result.periods.map((p) => p.periodStart)).toEqual([
        '2025-08-01T00:00:00.000Z',
        '2025-09-01T00:00:00.000Z',
        '2025-10-01T00:00:00.000Z',
      ]);
      expect(result.periods.map((p) => p.spent)).toEqual([600, 100, 100]);
      expect(result.periods.map((p) => p.limitAmount)).toEqual([500, 500, 500]);
      expect(result.periods[0]!.utilizationRate).toBeCloseTo(120, 5);
    });

    it('returns daily running totals for the selected period and the one before it', async () => {
      const { category, budget } = await createGroceriesBudget();
      const account = await helpers.createAccount({ raw: true });

      await createExpense({
        accountId: account.id,
        amount: 100,
        time: '2025-09-02T12:00:00Z',
        categoryId: category.id,
      });
      await createExpense({ accountId: account.id, amount: 40, time: '2025-10-02T12:00:00Z', categoryId: category.id });
      await createExpense({ accountId: account.id, amount: 60, time: '2025-10-03T12:00:00Z', categoryId: category.id });

      const { cumulative } = await helpers.getBudgetPeriods({
        id: budget.id,
        at: '2025-10-17T00:00:00.000Z',
        raw: true,
      });

      expect(cumulative.granularity).toBe('day');
      expect(cumulative.current).toHaveLength(31);
      expect(cumulative.previous).toHaveLength(30);
      expect(cumulative.current.slice(0, 3).map((s) => s.value)).toEqual([0, 40, 100]);
      expect(cumulative.current[30]!.value).toBe(100);
      expect(cumulative.previous[1]!.periodValue).toBe(100);
    });

    it('nets refunds out of the period they belong to', async () => {
      const { category, budget } = await createGroceriesBudget();
      const account = await helpers.createAccount({ raw: true });

      const purchase = await createExpense({
        accountId: account.id,
        amount: 100,
        time: '2025-10-02T12:00:00Z',
        categoryId: category.id,
      });
      await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 30,
            time: '2025-10-05T12:00:00Z',
            categoryId: category.id,
            transactionType: TRANSACTION_TYPES.income,
          }),
          refundForTxId: purchase.id,
        },
        raw: true,
      });

      const result = await helpers.getBudgetPeriods({
        id: budget.id,
        at: '2025-10-17T00:00:00.000Z',
        count: 1,
        raw: true,
      });
      const stats = await helpers.getStats({ id: budget.id, at: '2025-10-17T00:00:00.000Z', raw: true });

      expect(result.periods[0]!.spent).toBe(70);
      expect(result.periods[0]!.expense).toBe(stats!.summary.actualExpense);
      expect(result.periods[0]!.income).toBe(stats!.summary.actualIncome);
    });

    it('returns zeroes and never reaches before the first period', async () => {
      const { budget } = await createGroceriesBudget({ startDate: '2025-09-01T00:00:00.000Z' });

      const result = await helpers.getBudgetPeriods({
        id: budget.id,
        at: '2025-10-17T00:00:00.000Z',
        count: 12,
        raw: true,
      });

      expect(result.periods).toHaveLength(2);
      expect(result.periods.every((p) => p.spent === 0)).toBe(true);
    });

    it('has no previous running total in the first period', async () => {
      const { budget } = await createGroceriesBudget({ startDate: '2025-10-01T00:00:00.000Z' });

      const { cumulative } = await helpers.getBudgetPeriods({
        id: budget.id,
        at: '2025-10-17T00:00:00.000Z',
        raw: true,
      });

      expect(cumulative.previous).toEqual([]);
    });

    it('uses weekly steps for quarterly budgets and monthly steps for yearly ones', async () => {
      const { budget: quarterly } = await createGroceriesBudget({ recurrence: BUDGET_RECURRENCES.quarterly });
      const { budget: yearly } = await createGroceriesBudget({ recurrence: BUDGET_RECURRENCES.yearly });

      const quarterlyResult = await helpers.getBudgetPeriods({
        id: quarterly.id,
        at: '2025-08-01T00:00:00.000Z',
        raw: true,
      });
      const yearlyResult = await helpers.getBudgetPeriods({ id: yearly.id, at: '2025-08-01T00:00:00.000Z', raw: true });

      expect(quarterlyResult.cumulative.granularity).toBe('week');
      expect(quarterlyResult.cumulative.current).toHaveLength(14);
      expect(yearlyResult.cumulative.granularity).toBe('month');
      expect(yearlyResult.cumulative.current).toHaveLength(12);
    });

    it('rejects one-off budgets', async () => {
      const budget = await helpers.createCustomBudget({ name: 'Trip', raw: true });

      const response = await helpers.getBudgetPeriods({ id: budget.id });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('returns 404 for an unknown budget', async () => {
      const response = await helpers.getBudgetPeriods({ id: NONEXISTENT_ID });

      expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
    });
  });
});
