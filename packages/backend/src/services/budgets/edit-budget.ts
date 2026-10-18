import {
  BUDGET_RECURRENCES,
  BUDGET_ROLLOVERS,
  BUDGET_TYPES,
  type BudgetRuleGroup,
  type RecordId,
  SHARE_PERMISSIONS,
} from '@bt/shared/types';
import { Money } from '@common/types/money';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import Budgets from '@models/budget.model';
import Categories from '@models/categories.model';
import { withTransaction } from '@services/common/with-transaction';

import { authorizeBudgetAccess } from './authorize-budget-access';
import { normalizeRecurringDates } from './utils/budget-periods';
import { getBudgetRuleGroups, ruleGroupFromCategoryIds } from './utils/budget-rules';
import { normalizeBudgetRules, syncBudgetCategories } from './utils/normalize-budget-rules';

interface EditBudgetPayload {
  id: string;
  userId: number;
  name?: string;
  recurrence?: BUDGET_RECURRENCES;
  rollover?: BUDGET_ROLLOVERS;
  timezone?: string | null;
  startDate?: string;
  /** `null` clears the end date, so a recurring budget repeats until archived. */
  endDate?: string | null;
  limitAmount?: Money;
  autoInclude?: boolean;
  categoryIds?: string[];
  /** Automatic budgets only: the full new set of rules. */
  rules?: BudgetRuleGroup[];
}

export const editBudget = withTransaction(async ({ id, userId, categoryIds, rules, ...params }: EditBudgetPayload) => {
  // Manage-level required: metadata edits (name/dates/limit/autoInclude/categories) are
  // owner / manage-only per PRD reduced-write-scope decision. `write` recipients can
  // attach their own transactions but not mutate the budget definition itself, which
  // avoids "my partner renamed my budget" / "categories list moved under me" surprises.
  const { ownerUserId } = await authorizeBudgetAccess({
    userId,
    budgetId: id,
    requiredPermission: SHARE_PERMISSIONS.manage,
  });

  const budget = await findOrThrowNotFound({
    query: Budgets.findOne({ where: { id, userId: ownerUserId } }),
    message: t({ key: 'budgets.budgetNotFound' }),
  });

  await budget.update({ ...params, ...resolveDates({ budget, params }) });

  // Automatic budgets: `rules` replaces the rules. A plain `categoryIds` list (older
  // clients) replaces the categories of a single-rule budget; with several rules it
  // can't say which rule it means, so it has to come as `rules`.
  if (budget.type === BUDGET_TYPES.category && (rules !== undefined || categoryIds !== undefined)) {
    const current = getBudgetRuleGroups({ rules: budget.rules, categoryIds: [] });
    if (rules === undefined && current.length > 1) {
      throw new ValidationError({ message: t({ key: 'budgets.editRulesNotCategories' }) });
    }

    // Categories are resolved against the OWNER's category tree, not the caller's — a
    // `manage` recipient cannot inject categories from their own tree.
    const nextRules = await normalizeBudgetRules({
      userId: ownerUserId,
      groups: rules ?? [
        { ...(current[0] ?? ruleGroupFromCategoryIds({ categoryIds: [] })), categoryIds: categoryIds as RecordId[] },
      ],
    });

    await budget.update({ rules: nextRules });
    await syncBudgetCategories({ budgetId: budget.id, groups: nextRules });
  }

  const updatedBudget = await Budgets.findOne({
    where: { id, userId: ownerUserId },
    attributes: { exclude: ['userId'] },
    include:
      budget.type === BUDGET_TYPES.category
        ? [{ model: Categories, as: 'categories', attributes: ['id', 'name', 'color', 'parentId'] }]
        : [],
  });

  return updatedBudget;
});

/**
 * Dates to store after the edit. Recurring budgets are normalised against the merged
 * state (stored values overlaid with the edit), so changing only the recurrence or only
 * the start still leaves the dates on period boundaries.
 */
const resolveDates = ({
  budget,
  params,
}: {
  budget: Budgets;
  params: Omit<EditBudgetPayload, 'id' | 'userId' | 'categoryIds'>;
}): { startDate?: Date | null; endDate?: Date | null } => {
  const recurrence = params.recurrence ?? budget.recurrence;
  const startDate = params.startDate !== undefined ? new Date(params.startDate) : budget.startDate;
  const endDate =
    params.endDate === undefined ? budget.endDate : params.endDate === null ? null : new Date(params.endDate);

  if (recurrence === BUDGET_RECURRENCES.none) {
    return {
      ...(params.startDate !== undefined && { startDate }),
      ...(params.endDate !== undefined && { endDate }),
    };
  }

  if (!startDate) {
    throw new ValidationError({ message: t({ key: 'budgets.recurringRequiresStartDate' }) });
  }

  return normalizeRecurringDates({
    budget: {
      recurrence,
      timezone: params.timezone !== undefined ? params.timezone : budget.timezone,
      startDate,
      endDate,
    },
  });
};
