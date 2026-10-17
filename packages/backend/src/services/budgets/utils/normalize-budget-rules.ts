import type { BudgetRuleGroup, RecordId } from '@bt/shared/types';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import Accounts from '@models/accounts.model';
import BudgetCategories from '@models/budget-categories.model';
import Categories from '@models/categories.model';
import Payees from '@models/payees.model';
import Tags from '@models/tags.model';
import { Op } from 'sequelize';

import { collectRuleCategoryIds, hasConditions } from './budget-rules';
import { expandCategoryIds } from './expand-category-ids';

const unique = <T>(values: T[]): T[] => [...new Set(values)];

/** Throws unless every id names a row of `model` owned by `userId`. */
const assertOwned = async ({
  model,
  ids,
  userId,
}: {
  model: typeof Categories | typeof Tags | typeof Accounts | typeof Payees;
  ids: string[];
  userId: number;
}) => {
  if (!ids.length) return;
  const count = await (model as typeof Categories).count({ where: { id: { [Op.in]: ids }, userId } });
  if (count !== ids.length) {
    throw new ValidationError({ message: t({ key: 'budgets.someRuleIdsInvalid' }) });
  }
};

/**
 * Rules as they are stored: every id checked against the owner's data, parent categories
 * expanded to include their children (as category budgets always have), duplicates and
 * empty rules dropped. At least one rule must remain.
 */
export const normalizeBudgetRules = async ({
  userId,
  groups,
}: {
  userId: number;
  groups: BudgetRuleGroup[];
}): Promise<BudgetRuleGroup[]> => {
  const all = (pick: (group: BudgetRuleGroup) => RecordId[]) => unique(groups.flatMap(pick));

  await Promise.all([
    assertOwned({ model: Categories, ids: all((g) => g.categoryIds), userId }),
    assertOwned({ model: Tags, ids: all((g) => g.tagIds), userId }),
    assertOwned({ model: Accounts, ids: all((g) => g.accountIds), userId }),
    assertOwned({ model: Payees, ids: all((g) => g.payeeIds), userId }),
  ]);

  const normalized: BudgetRuleGroup[] = [];
  for (const group of groups) {
    const categoryIds = group.categoryIds.length
      ? ((await expandCategoryIds({ userId, categoryIds: unique(group.categoryIds) })) as RecordId[])
      : [];
    const next: BudgetRuleGroup = {
      categoryIds,
      tagIds: unique(group.tagIds),
      tagMatch: group.tagMatch,
      accountIds: unique(group.accountIds),
      payeeIds: unique(group.payeeIds),
    };
    if (hasConditions({ group: next })) normalized.push(next);
  }

  if (!normalized.length) {
    throw new ValidationError({ message: t({ key: 'budgets.rulesRequireCondition' }) });
  }

  return normalized;
};

/** Keeps `BudgetCategories` equal to the categories the rules name. */
export const syncBudgetCategories = async ({ budgetId, groups }: { budgetId: RecordId; groups: BudgetRuleGroup[] }) => {
  await BudgetCategories.destroy({ where: { budgetId } });
  const categoryIds = collectRuleCategoryIds({ groups });
  if (categoryIds.length) {
    await BudgetCategories.bulkCreate(categoryIds.map((categoryId) => ({ budgetId, categoryId })));
  }
};
