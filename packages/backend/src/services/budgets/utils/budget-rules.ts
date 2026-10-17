import type { BudgetRuleGroup, RecordId } from '@bt/shared/types';

/** A rule with every list empty matches nothing rather than everything. */
export const hasConditions = ({ group }: { group: BudgetRuleGroup }): boolean =>
  group.categoryIds.length > 0 || group.tagIds.length > 0 || group.accountIds.length > 0 || group.payeeIds.length > 0;

/** A single categories-only rule: what every budget created before rules existed amounts to. */
export const ruleGroupFromCategoryIds = ({ categoryIds }: { categoryIds: RecordId[] }): BudgetRuleGroup => ({
  categoryIds,
  tagIds: [],
  tagMatch: 'any',
  accountIds: [],
  payeeIds: [],
});

/** Rules a budget matches by: its stored rules, or its categories as one rule when it predates rules. */
export const getBudgetRuleGroups = ({
  rules,
  categoryIds,
}: {
  rules: BudgetRuleGroup[] | null | undefined;
  categoryIds: RecordId[];
}): BudgetRuleGroup[] =>
  (rules ?? (categoryIds.length ? [ruleGroupFromCategoryIds({ categoryIds })] : [])).filter((group) =>
    hasConditions({ group }),
  );

/** Every category any rule names; kept in `BudgetCategories` for display and export. */
export const collectRuleCategoryIds = ({ groups }: { groups: BudgetRuleGroup[] }): RecordId[] => [
  ...new Set(groups.flatMap((group) => group.categoryIds)),
];

export interface RuleCandidate {
  categoryId: RecordId | null;
  accountId: RecordId;
  payeeId: RecordId | null;
  tagIds: ReadonlySet<string>;
  /** Base-currency cents of the whole transaction. */
  cents: number;
  splits: { id: string; categoryId: RecordId; cents: number }[];
}

/**
 * The parts of a transaction a budget counts. `remainder` is what the splits leave on
 * the transaction's own category (the whole amount when there are no splits).
 */
export interface RuleMatch {
  remainder: boolean;
  splitIds: Set<string>;
}

const meetsTransactionConditions = ({ group, tx }: { group: BudgetRuleGroup; tx: RuleCandidate }): boolean => {
  if (group.accountIds.length && !group.accountIds.includes(tx.accountId)) return false;
  if (group.payeeIds.length && (tx.payeeId === null || !group.payeeIds.includes(tx.payeeId))) return false;
  if (group.tagIds.length) {
    const hasTag = (tagId: string) => tx.tagIds.has(tagId);
    const tagsMatch = group.tagMatch === 'all' ? group.tagIds.every(hasTag) : group.tagIds.some(hasTag);
    if (!tagsMatch) return false;
  }
  return true;
};

/**
 * Which parts of `tx` the rules count, or null when no rule matches.
 *
 * - Conditions inside one rule must all hold; any rule matching is enough.
 * - Tags, account and payee are checked on the transaction as a whole.
 * - A rule with categories counts the matching parts only: the remainder when the
 *   transaction's own category matches, plus each split whose category matches.
 * - A rule without categories counts the whole transaction: the remainder and every split.
 * - Parts matched by several rules count once.
 */
export const matchRuleGroups = ({ groups, tx }: { groups: BudgetRuleGroup[]; tx: RuleCandidate }): RuleMatch | null => {
  const match: RuleMatch = { remainder: false, splitIds: new Set() };
  const splitsCents = tx.splits.reduce((sum, split) => sum + split.cents, 0);
  const hasRemainder = tx.cents - splitsCents > 0;

  for (const group of groups) {
    if (!hasConditions({ group }) || !meetsTransactionConditions({ group, tx })) continue;

    if (!group.categoryIds.length) {
      if (hasRemainder) match.remainder = true;
      tx.splits.forEach((split) => match.splitIds.add(split.id));
      continue;
    }

    if (hasRemainder && tx.categoryId !== null && group.categoryIds.includes(tx.categoryId)) match.remainder = true;
    for (const split of tx.splits) {
      if (group.categoryIds.includes(split.categoryId)) match.splitIds.add(split.id);
    }
  }

  return match.remainder || match.splitIds.size > 0 ? match : null;
};
