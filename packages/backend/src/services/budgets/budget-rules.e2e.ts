import { BUDGET_TYPES, type RecordId, TRANSACTION_TYPES } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';

/**
 * Rule groups on automatic budgets: categories, tags, accounts and payees, combined with
 * AND inside a rule and OR across rules.
 */

let seq = 0;
const next = () => {
  seq += 1;
  return seq;
};

const createCategory = async (name: string) =>
  helpers.addCustomCategory({ name: `${name} ${next()}`, color: '#FF0000', raw: true });
const createTag = async (name: string) =>
  helpers.createTag({ payload: { name: `${name} ${next()}`, color: '#00FF00' }, raw: true });

const createExpense = async ({
  accountId,
  categoryId,
  amount,
  tagIds,
  payeeId,
  splits,
}: {
  accountId: RecordId;
  categoryId: RecordId;
  amount: number;
  tagIds?: string[];
  payeeId?: RecordId;
  splits?: { amount: number; categoryId: RecordId }[];
}) => {
  const [tx] = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({
      accountId,
      categoryId,
      amount,
      transactionType: TRANSACTION_TYPES.expense,
      time: '2025-10-05T12:00:00Z',
      ...(tagIds && { tagIds }),
      ...(payeeId && { payeeId }),
      ...(splits && { splits }),
    }),
    raw: true,
  });
  return tx!;
};

const spentOf = async ({ budgetId }: { budgetId: string }) => {
  const stats = await helpers.getStats({ id: budgetId, raw: true });
  return { expense: stats!.summary.actualExpense, count: stats!.summary.transactionsCount };
};

describe('Budget rules', () => {
  describe('matching', () => {
    it('counts tagged transactions in any category with a tags-only rule', async () => {
      const [food, fuel] = await Promise.all([createCategory('Food'), createCategory('Fuel')]);
      const vacation = await createTag('Vacation');
      const account = await helpers.createAccount({ raw: true });

      await createExpense({ accountId: account.id, categoryId: food.id, amount: 30, tagIds: [vacation.id] });
      await createExpense({ accountId: account.id, categoryId: fuel.id, amount: 50, tagIds: [vacation.id] });
      await createExpense({ accountId: account.id, categoryId: food.id, amount: 999 });

      const budget = await helpers.createCustomBudget({
        name: 'Vacation',
        type: BUDGET_TYPES.category,
        rules: [{ tagIds: [vacation.id] }],
        raw: true,
      });

      expect(await spentOf({ budgetId: budget.id })).toEqual({ expense: 80, count: 2 });
    });

    it('requires every condition of a rule', async () => {
      const restaurants = await createCategory('Restaurants');
      const vacation = await createTag('Vacation');
      const account = await helpers.createAccount({ raw: true });

      await createExpense({ accountId: account.id, categoryId: restaurants.id, amount: 40, tagIds: [vacation.id] });
      await createExpense({ accountId: account.id, categoryId: restaurants.id, amount: 999 });

      const budget = await helpers.createCustomBudget({
        name: 'Holiday dining',
        type: BUDGET_TYPES.category,
        rules: [{ categoryIds: [restaurants.id], tagIds: [vacation.id] }],
        raw: true,
      });

      expect(await spentOf({ budgetId: budget.id })).toEqual({ expense: 40, count: 1 });
    });

    it('counts a transaction once when several rules match it', async () => {
      const flights = await createCategory('Flights');
      const vacation = await createTag('Vacation');
      const account = await helpers.createAccount({ raw: true });

      await createExpense({ accountId: account.id, categoryId: flights.id, amount: 300, tagIds: [vacation.id] });
      await createExpense({ accountId: account.id, categoryId: flights.id, amount: 200 });

      const budget = await helpers.createCustomBudget({
        name: 'Travel',
        type: BUDGET_TYPES.category,
        rules: [{ categoryIds: [flights.id] }, { tagIds: [vacation.id] }],
        raw: true,
      });

      expect(await spentOf({ budgetId: budget.id })).toEqual({ expense: 500, count: 2 });
    });

    it('needs every tag for an all-tags rule', async () => {
      const food = await createCategory('Food');
      const [work, travel] = await Promise.all([createTag('Work'), createTag('Travel')]);
      const account = await helpers.createAccount({ raw: true });

      await createExpense({ accountId: account.id, categoryId: food.id, amount: 10, tagIds: [work.id] });
      await createExpense({ accountId: account.id, categoryId: food.id, amount: 25, tagIds: [work.id, travel.id] });

      const budget = await helpers.createCustomBudget({
        name: 'Work trips',
        type: BUDGET_TYPES.category,
        rules: [{ tagIds: [work.id, travel.id], tagMatch: 'all' }],
        raw: true,
      });

      expect(await spentOf({ budgetId: budget.id })).toEqual({ expense: 25, count: 1 });
    });

    it('matches by account and by payee', async () => {
      const food = await createCategory('Food');
      const [card, cash] = await Promise.all([
        helpers.createAccount({ raw: true }),
        helpers.createAccount({ raw: true }),
      ]);
      const shop = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: `Shop ${next()}` }),
        raw: true,
      });

      await createExpense({ accountId: card.id, categoryId: food.id, amount: 15 });
      await createExpense({ accountId: cash.id, categoryId: food.id, amount: 70, payeeId: shop.id });

      const cardBudget = await helpers.createCustomBudget({
        name: 'Card',
        type: BUDGET_TYPES.category,
        rules: [{ accountIds: [card.id] }],
        raw: true,
      });
      const shopBudget = await helpers.createCustomBudget({
        name: 'Shop',
        type: BUDGET_TYPES.category,
        rules: [{ payeeIds: [shop.id] }],
        raw: true,
      });

      expect(await spentOf({ budgetId: cardBudget.id })).toEqual({ expense: 15, count: 1 });
      expect(await spentOf({ budgetId: shopBudget.id })).toEqual({ expense: 70, count: 1 });
    });

    describe('split transactions', () => {
      it('counts the whole transaction for a tags-only rule', async () => {
        const [food, household] = await Promise.all([createCategory('Food'), createCategory('Household')]);
        const vacation = await createTag('Vacation');
        const account = await helpers.createAccount({ raw: true });

        // $100 food with $40 split off to household, tagged vacation.
        await createExpense({
          accountId: account.id,
          categoryId: food.id,
          amount: 100,
          tagIds: [vacation.id],
          splits: [{ amount: 40, categoryId: household.id }],
        });

        const budget = await helpers.createCustomBudget({
          name: 'Vacation',
          type: BUDGET_TYPES.category,
          rules: [{ tagIds: [vacation.id] }],
          raw: true,
        });

        expect(await spentOf({ budgetId: budget.id })).toEqual({ expense: 100, count: 1 });
      });

      it('counts only the matching split for a category and tag rule', async () => {
        const [food, household] = await Promise.all([createCategory('Food'), createCategory('Household')]);
        const vacation = await createTag('Vacation');
        const account = await helpers.createAccount({ raw: true });

        await createExpense({
          accountId: account.id,
          categoryId: food.id,
          amount: 100,
          tagIds: [vacation.id],
          splits: [{ amount: 40, categoryId: household.id }],
        });

        const budget = await helpers.createCustomBudget({
          name: 'Holiday household',
          type: BUDGET_TYPES.category,
          rules: [{ categoryIds: [household.id], tagIds: [vacation.id] }],
          raw: true,
        });

        expect(await spentOf({ budgetId: budget.id })).toEqual({ expense: 40, count: 1 });
        const spending = await helpers.getSpendingStats({ id: budget.id, raw: true });
        expect(spending.spendingsByCategory.map((c) => [c.categoryId, c.amount])).toEqual([[household.id, 40]]);
      });
    });
  });

  describe('saving', () => {
    it('stores categoryIds as one rule with parent categories expanded', async () => {
      const parent = await createCategory('Parent');
      const child = await helpers.addCustomCategory({
        name: `Child ${next()}`,
        color: '#0000FF',
        parentId: parent.id,
        raw: true,
      });

      const budget = await helpers.createCustomBudget({
        name: 'Legacy',
        type: BUDGET_TYPES.category,
        categoryIds: [parent.id],
        raw: true,
      });

      expect(budget.rules).toHaveLength(1);
      expect(budget.rules![0]!.categoryIds.toSorted()).toEqual([parent.id, child.id].toSorted());
      expect(budget.rules![0]!.tagIds).toEqual([]);
    });

    it('lists every rule category on the budget', async () => {
      const [food, fuel] = await Promise.all([createCategory('Food'), createCategory('Fuel')]);
      const vacation = await createTag('Vacation');

      const budget = await helpers.createCustomBudget({
        name: 'Mixed',
        type: BUDGET_TYPES.category,
        rules: [{ categoryIds: [food.id] }, { categoryIds: [fuel.id], tagIds: [vacation.id] }],
        raw: true,
      });

      expect(budget.categories.map((c) => c.id).toSorted()).toEqual([food.id, fuel.id].toSorted());
    });

    it('rejects ids the user does not own', async () => {
      const otherUser = await helpers.provisionSecondUserWithBaseCurrency();
      const foreignTag = await helpers.asUser({
        cookies: otherUser.cookies,
        fn: () => createTag('Foreign'),
      });

      const response = await helpers.createCustomBudget({
        name: 'Sneaky',
        type: BUDGET_TYPES.category,
        rules: [{ tagIds: [foreignTag.id] }],
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('rejects rules without any condition', async () => {
      const response = await helpers.createCustomBudget({
        name: 'Empty',
        type: BUDGET_TYPES.category,
        rules: [{}],
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });

  describe('editing', () => {
    it('replaces the rules', async () => {
      const [food, fuel] = await Promise.all([createCategory('Food'), createCategory('Fuel')]);
      const account = await helpers.createAccount({ raw: true });
      await createExpense({ accountId: account.id, categoryId: fuel.id, amount: 60 });

      const budget = await helpers.createCustomBudget({
        name: 'Swap',
        type: BUDGET_TYPES.category,
        categoryIds: [food.id],
        raw: true,
      });

      const updated = await helpers.editCustomBudget({
        id: budget.id,
        params: { rules: [{ categoryIds: [fuel.id] }] },
        raw: true,
      });

      expect(updated.rules![0]!.categoryIds).toEqual([fuel.id]);
      expect(updated.categories!.map((c) => c.id)).toEqual([fuel.id]);
      expect(await spentOf({ budgetId: budget.id })).toEqual({ expense: 60, count: 1 });
    });

    it('keeps the other conditions when only the categories of a single rule change', async () => {
      const [food, fuel] = await Promise.all([createCategory('Food'), createCategory('Fuel')]);
      const vacation = await createTag('Vacation');

      const budget = await helpers.createCustomBudget({
        name: 'Keep tags',
        type: BUDGET_TYPES.category,
        rules: [{ categoryIds: [food.id], tagIds: [vacation.id] }],
        raw: true,
      });

      const updated = await helpers.editCustomBudget({ id: budget.id, params: { categoryIds: [fuel.id] }, raw: true });

      expect(updated.rules).toEqual([
        { categoryIds: [fuel.id], tagIds: [vacation.id], tagMatch: 'any', accountIds: [], payeeIds: [] },
      ]);
    });

    it('asks for rules when categories are edited on a budget with several rules', async () => {
      const [food, fuel] = await Promise.all([createCategory('Food'), createCategory('Fuel')]);
      const vacation = await createTag('Vacation');

      const budget = await helpers.createCustomBudget({
        name: 'Many rules',
        type: BUDGET_TYPES.category,
        rules: [{ categoryIds: [food.id] }, { tagIds: [vacation.id] }],
        raw: true,
      });

      const response = await helpers.editCustomBudget({
        id: budget.id,
        params: { categoryIds: [fuel.id] },
        raw: false,
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });
});
