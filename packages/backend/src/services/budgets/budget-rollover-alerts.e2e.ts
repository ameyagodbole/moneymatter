import {
  BUDGET_RECURRENCES,
  BUDGET_ROLLOVERS,
  BUDGET_TYPES,
  NOTIFICATION_TYPES,
  type RecordId,
} from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';

import { checkBudgetAlerts } from './check-budget-alerts';

/**
 * Rollover between periods, and limit alerts.
 *
 * Alerts are driven by an hourly cron with no endpoint of its own, so these tests call
 * `checkBudgetAlerts` directly with a fixed `now`, as the subscription reminder tests do
 * for their cron. Everything else goes through the API.
 */

let seq = 0;

const setUp = async ({ rollover = BUDGET_ROLLOVERS.none, limitAmount = 500 } = {}) => {
  seq += 1;
  const category = await helpers.addCustomCategory({ name: `Groceries ${seq}`, color: '#FF0000', raw: true });
  const budget = await helpers.createCustomBudget({
    name: `Groceries ${seq}`,
    type: BUDGET_TYPES.category,
    categoryIds: [category.id],
    recurrence: BUDGET_RECURRENCES.monthly,
    rollover,
    startDate: '2025-09-01T00:00:00.000Z',
    limitAmount,
    raw: true,
  });
  const account = await helpers.createAccount({ raw: true });
  return { category, budget, account };
};

const spend = async ({
  accountId,
  categoryId,
  amount,
  time,
}: {
  accountId: RecordId;
  categoryId: RecordId;
  amount: number;
  time: string;
}) => {
  await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({ accountId, categoryId, amount, time }),
    raw: true,
  });
};

const alertsFor = async ({ budgetId }: { budgetId: string }) => {
  const notifications = await helpers.getNotifications({ type: NOTIFICATION_TYPES.budgetAlert, raw: true });
  return notifications
    .filter((n) => (n.payload as { budgetId?: string }).budgetId === budgetId)
    .map((n) => (n.payload as { threshold: number }).threshold)
    .toSorted((a, b) => a - b);
};

describe('Budget rollover', () => {
  it('adds unspent limit to the next period with surplus', async () => {
    const { category, budget, account } = await setUp({ rollover: BUDGET_ROLLOVERS.surplus });
    await spend({ accountId: account.id, categoryId: category.id, amount: 300, time: '2025-09-10T12:00:00Z' });
    await spend({ accountId: account.id, categoryId: category.id, amount: 350, time: '2025-10-10T12:00:00Z' });

    const stats = await helpers.getStats({ id: budget.id, at: '2025-10-15T00:00:00.000Z', raw: true });

    expect(stats!.summary.limitAmount).toBe(700);
    expect(stats!.summary.rolledOverAmount).toBe(200);
    expect(stats!.summary.utilizationRate).toBeCloseTo(50, 5);

    const history = await helpers.getBudgetPeriods({ id: budget.id, at: '2025-10-15T00:00:00.000Z', raw: true });
    expect(history.periods.map((p) => p.limitAmount)).toEqual([500, 700]);
  });

  it('never carries overspending with surplus', async () => {
    const { category, budget, account } = await setUp({ rollover: BUDGET_ROLLOVERS.surplus });
    await spend({ accountId: account.id, categoryId: category.id, amount: 800, time: '2025-09-10T12:00:00Z' });

    const stats = await helpers.getStats({ id: budget.id, at: '2025-10-15T00:00:00.000Z', raw: true });

    expect(stats!.summary.limitAmount).toBe(500);
    expect(stats!.summary.rolledOverAmount).toBe(0);
  });

  it('takes overspending off the next period with all', async () => {
    const { category, budget, account } = await setUp({ rollover: BUDGET_ROLLOVERS.all });
    await spend({ accountId: account.id, categoryId: category.id, amount: 650, time: '2025-09-10T12:00:00Z' });

    const stats = await helpers.getStats({ id: budget.id, at: '2025-10-15T00:00:00.000Z', raw: true });

    expect(stats!.summary.limitAmount).toBe(350);
    expect(stats!.summary.rolledOverAmount).toBe(-150);
  });

  it('keeps the base limit without rollover', async () => {
    const { category, budget, account } = await setUp();
    await spend({ accountId: account.id, categoryId: category.id, amount: 100, time: '2025-09-10T12:00:00Z' });

    const stats = await helpers.getStats({ id: budget.id, at: '2025-10-15T00:00:00.000Z', raw: true });

    expect(stats!.summary.limitAmount).toBe(500);
    expect(stats!.summary.rolledOverAmount).toBe(0);
  });

  it('can be switched on later', async () => {
    const { category, budget, account } = await setUp();
    await spend({ accountId: account.id, categoryId: category.id, amount: 100, time: '2025-09-10T12:00:00Z' });

    const updated = await helpers.editCustomBudget({
      id: budget.id,
      params: { rollover: BUDGET_ROLLOVERS.surplus },
      raw: true,
    });
    expect(updated.rollover).toBe(BUDGET_ROLLOVERS.surplus);

    const stats = await helpers.getStats({ id: budget.id, at: '2025-10-15T00:00:00.000Z', raw: true });
    expect(stats!.summary.limitAmount).toBe(900);
  });
});

describe('Budget alerts', () => {
  const now = new Date('2025-10-20T12:00:00.000Z');

  it('notifies once at 80% and once at 100% within a period', async () => {
    const { category, budget, account } = await setUp({ limitAmount: 100 });
    await spend({ accountId: account.id, categoryId: category.id, amount: 85, time: '2025-10-05T12:00:00Z' });

    await checkBudgetAlerts({ now });
    await checkBudgetAlerts({ now });
    expect(await alertsFor({ budgetId: budget.id })).toEqual([80]);

    await spend({ accountId: account.id, categoryId: category.id, amount: 20, time: '2025-10-06T12:00:00Z' });
    await checkBudgetAlerts({ now });
    expect(await alertsFor({ budgetId: budget.id })).toEqual([80, 100]);
  });

  it('sends only the 100% alert when spending jumps past both thresholds', async () => {
    const { category, budget, account } = await setUp({ limitAmount: 100 });
    await spend({ accountId: account.id, categoryId: category.id, amount: 150, time: '2025-10-05T12:00:00Z' });

    await checkBudgetAlerts({ now });

    expect(await alertsFor({ budgetId: budget.id })).toEqual([100]);
  });

  it('starts over in the next period', async () => {
    const { category, budget, account } = await setUp({ limitAmount: 100 });
    await spend({ accountId: account.id, categoryId: category.id, amount: 90, time: '2025-09-05T12:00:00Z' });
    await checkBudgetAlerts({ now: new Date('2025-09-20T12:00:00.000Z') });

    await spend({ accountId: account.id, categoryId: category.id, amount: 90, time: '2025-10-05T12:00:00Z' });
    await checkBudgetAlerts({ now });

    expect(await alertsFor({ budgetId: budget.id })).toEqual([80, 80]);
  });

  it('stays quiet below 80% and for budgets without a limit', async () => {
    const { category, budget, account } = await setUp({ limitAmount: 100 });
    await spend({ accountId: account.id, categoryId: category.id, amount: 50, time: '2025-10-05T12:00:00Z' });
    const noLimit = await helpers.createCustomBudget({
      name: 'No limit',
      type: BUDGET_TYPES.category,
      categoryIds: [category.id],
      raw: true,
    });

    await checkBudgetAlerts({ now });

    expect(await alertsFor({ budgetId: budget.id })).toEqual([]);
    expect(await alertsFor({ budgetId: noLimit.id })).toEqual([]);
  });

  it('respects the budget alerts notification setting', async () => {
    const { category, budget, account } = await setUp({ limitAmount: 100 });
    await spend({ accountId: account.id, categoryId: category.id, amount: 95, time: '2025-10-05T12:00:00Z' });
    await helpers.patchUserSettings({
      patch: {
        notifications: {
          enabled: true,
          types: {
            [NOTIFICATION_TYPES.budgetAlert]: false,
            [NOTIFICATION_TYPES.system]: true,
            [NOTIFICATION_TYPES.changelog]: true,
          },
        },
      },
      raw: true,
    });

    await checkBudgetAlerts({ now });

    expect(await alertsFor({ budgetId: budget.id })).toEqual([]);
  });
});
