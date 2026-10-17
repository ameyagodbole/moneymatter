import {
  BUDGET_RECURRENCES,
  BUDGET_STATUSES,
  BUDGET_TYPES,
  type BudgetRuleGroup,
  type RecordId,
} from '@bt/shared/types';
import { Money } from '@common/types/money';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import BudgetTransactions from '@models/budget-transactions.model';
import Budgets from '@models/budget.model';
import Categories from '@models/categories.model';
import { findTransactions } from '@models/transactions-query';
import { withTransaction } from '@services/common/with-transaction';
import { Op } from 'sequelize';

import { normalizeRecurringDates } from './utils/budget-periods';
import { ruleGroupFromCategoryIds } from './utils/budget-rules';
import { normalizeBudgetRules, syncBudgetCategories } from './utils/normalize-budget-rules';

interface CreateBudgetPayload {
  id?: string;
  userId: number;
  name: string;
  status: string;
  type?: BUDGET_TYPES;
  recurrence?: BUDGET_RECURRENCES;
  timezone?: string | null;
  categoryIds?: string[];
  /** Automatic budgets only. Takes precedence over `categoryIds`. */
  rules?: BudgetRuleGroup[] | null;
  startDate?: Date | null;
  endDate?: Date | null;
  autoInclude?: boolean;
  limitAmount?: Money | null;
}

const prepareTransactionFilters = (payload: CreateBudgetPayload) => ({
  userId: payload.userId,
  startDate: payload.startDate,
  endDate: payload.endDate,
  autoInclude: payload.autoInclude,
});

export const createBudget = withTransaction(async (payload: CreateBudgetPayload) => {
  const budgetType = payload.type ?? BUDGET_TYPES.manual;
  const recurrence = payload.recurrence ?? BUDGET_RECURRENCES.none;
  const timezone = payload.timezone ?? null;

  let startDate = payload.startDate ?? null;
  let endDate = payload.endDate ?? null;

  if (recurrence !== BUDGET_RECURRENCES.none) {
    if (!startDate) {
      throw new ValidationError({ message: t({ key: 'budgets.recurringRequiresStartDate' }) });
    }
    ({ startDate, endDate } = normalizeRecurringDates({ budget: { recurrence, timezone, startDate, endDate } }));
  }

  const budgetData: CreateBudgetPayload = {
    name: payload.name,
    userId: payload.userId,
    status: payload.status || BUDGET_STATUSES.active,
    type: budgetType,
    recurrence,
    timezone,
    startDate,
    endDate,
    autoInclude: payload.autoInclude ?? false,
    limitAmount: payload.limitAmount ?? null,
  };

  // Automatic budgets match by rules. A plain `categoryIds` list is one categories-only rule.
  const rules =
    budgetType === BUDGET_TYPES.category
      ? await normalizeBudgetRules({
          userId: payload.userId,
          groups: payload.rules ?? [
            ruleGroupFromCategoryIds({ categoryIds: (payload.categoryIds ?? []) as RecordId[] }),
          ],
        })
      : null;

  const budget = await createBudgetModel({ ...budgetData, rules });

  if (rules) await syncBudgetCategories({ budgetId: budget.id, groups: rules });

  // For manual budgets with autoInclude, link transactions by date range
  if (budgetType === BUDGET_TYPES.manual && payload.autoInclude && payload.startDate && payload.endDate) {
    const transactionFilters = prepareTransactionFilters(budgetData);
    const transactions = await findTransactions({
      planned: 'exclude',
      access: { creator: transactionFilters.userId },
      balanceAdjustments: 'include',
      completeness: 'all',
      where: {
        time: {
          [Op.between]: [transactionFilters.startDate, transactionFilters.endDate],
        },
      },
      attributes: ['id'],
    });

    if (transactions.length) {
      const transactionIds = transactions.map((tx) => tx.id);
      await BudgetTransactions.bulkCreate(
        transactionIds.map((transactionId) => ({
          budgetId: budget.id,
          transactionId,
        })),
      );
    }
  }

  // Reload budget with categories for category-based budgets
  const reloadedBudget = await Budgets.findByPk(budget.id, {
    attributes: { exclude: ['userId'] },
    include:
      budgetType === BUDGET_TYPES.category
        ? [{ model: Categories, as: 'categories', attributes: ['id', 'name', 'color', 'parentId'] }]
        : [],
  });

  return reloadedBudget!;
});

const createBudgetModel = async ({
  name,
  status,
  type,
  recurrence,
  timezone,
  userId,
  startDate,
  endDate,
  autoInclude,
  limitAmount,
  rules,
}: CreateBudgetPayload) => {
  const budgetData = {
    name,
    userId,
    status: status || BUDGET_STATUSES.active,
    type: type || BUDGET_TYPES.manual,
    recurrence: recurrence ?? BUDGET_RECURRENCES.none,
    timezone: timezone ?? null,
    startDate: startDate || null,
    endDate: endDate || null,
    autoInclude: autoInclude ?? false,
    limitAmount: limitAmount ?? null,
    rules: rules ?? null,
  };

  const budget = await Budgets.create(budgetData);
  return budget;
};
