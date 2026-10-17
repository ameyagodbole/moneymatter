import type { BudgetModel, BudgetRuleGroup, RecordId } from '@bt/shared/types';

export const createEmptyRule = (): BudgetRuleGroup => ({
  categoryIds: [],
  tagIds: [],
  tagMatch: 'any',
  accountIds: [],
  payeeIds: [],
});

/** A rule with nothing filled in matches nothing, so it can't be saved. */
export const isRuleEmpty = ({ rule }: { rule: BudgetRuleGroup }): boolean =>
  !rule.categoryIds.length && !rule.tagIds.length && !rule.accountIds.length && !rule.payeeIds.length;

/** The rules to edit: the stored ones, or the categories of an older budget as one rule. */
export const getEditableRules = ({
  budget,
}: {
  budget: Pick<BudgetModel, 'rules' | 'categories'>;
}): BudgetRuleGroup[] => {
  if (budget.rules?.length) return budget.rules.map((rule) => ({ ...rule }));
  const categoryIds = (budget.categories ?? []).map((category) => category.id as RecordId);
  return [{ ...createEmptyRule(), categoryIds }];
};

/** The rules worth sending: the non-empty ones. */
export const getSavableRules = ({ rules }: { rules: BudgetRuleGroup[] }): BudgetRuleGroup[] =>
  rules.filter((rule) => !isRuleEmpty({ rule }));
