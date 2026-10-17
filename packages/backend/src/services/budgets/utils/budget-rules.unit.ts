import type { BudgetRuleGroup, RecordId } from '@bt/shared/types';

import { type RuleCandidate, getBudgetRuleGroups, matchRuleGroups, ruleGroupFromCategoryIds } from './budget-rules';

const id = (value: string) => value as RecordId;

const rule = (overrides: Partial<BudgetRuleGroup> = {}): BudgetRuleGroup => ({
  ...ruleGroupFromCategoryIds({ categoryIds: [] }),
  ...overrides,
});

const tx = (overrides: Partial<RuleCandidate> = {}): RuleCandidate => ({
  categoryId: id('groceries'),
  accountId: id('card'),
  payeeId: null,
  tagIds: new Set(),
  cents: 10_000,
  splits: [],
  ...overrides,
});

const describeMatch = (match: ReturnType<typeof matchRuleGroups>) =>
  match ? { remainder: match.remainder, splitIds: [...match.splitIds].toSorted() } : null;

describe('matchRuleGroups', () => {
  it('matches a transaction by category', () => {
    const groups = [rule({ categoryIds: [id('groceries')] })];

    expect(describeMatch(matchRuleGroups({ groups, tx: tx() }))).toEqual({ remainder: true, splitIds: [] });
    expect(matchRuleGroups({ groups, tx: tx({ categoryId: id('fuel') }) })).toBeNull();
  });

  it('requires every condition of a rule', () => {
    const groups = [rule({ categoryIds: [id('restaurants')], tagIds: [id('vacation')] })];

    expect(matchRuleGroups({ groups, tx: tx({ categoryId: id('restaurants') }) })).toBeNull();
    expect(
      matchRuleGroups({ groups, tx: tx({ categoryId: id('restaurants'), tagIds: new Set(['vacation']) }) }),
    ).not.toBeNull();
  });

  it('matches when any rule does', () => {
    const groups = [rule({ categoryIds: [id('flights')] }), rule({ tagIds: [id('vacation')] })];

    expect(matchRuleGroups({ groups, tx: tx({ categoryId: id('flights') }) })).not.toBeNull();
    expect(matchRuleGroups({ groups, tx: tx({ tagIds: new Set(['vacation']) }) })).not.toBeNull();
    expect(matchRuleGroups({ groups, tx: tx() })).toBeNull();
  });

  it('distinguishes any-tag from all-tags rules', () => {
    const tags = [id('work'), id('travel')];
    const oneTag = tx({ tagIds: new Set(['work']) });
    const bothTags = tx({ tagIds: new Set(['work', 'travel']) });

    expect(matchRuleGroups({ groups: [rule({ tagIds: tags, tagMatch: 'any' })], tx: oneTag })).not.toBeNull();
    expect(matchRuleGroups({ groups: [rule({ tagIds: tags, tagMatch: 'all' })], tx: oneTag })).toBeNull();
    expect(matchRuleGroups({ groups: [rule({ tagIds: tags, tagMatch: 'all' })], tx: bothTags })).not.toBeNull();
  });

  it('checks accounts and payees on the transaction', () => {
    const groups = [rule({ accountIds: [id('card')], payeeIds: [id('shop')] })];

    expect(matchRuleGroups({ groups, tx: tx({ payeeId: id('shop') }) })).not.toBeNull();
    expect(matchRuleGroups({ groups, tx: tx({ payeeId: null }) })).toBeNull();
    expect(matchRuleGroups({ groups, tx: tx({ accountId: id('cash'), payeeId: id('shop') }) })).toBeNull();
  });

  describe('split transactions', () => {
    // $100 groceries with $40 split off to household: $60 stays in groceries.
    const split = tx({ splits: [{ id: 's1', categoryId: id('household'), cents: 4_000 }] });

    it('counts only the matching parts for a category rule', () => {
      expect(describeMatch(matchRuleGroups({ groups: [rule({ categoryIds: [id('groceries')] })], tx: split }))).toEqual(
        { remainder: true, splitIds: [] },
      );
      expect(describeMatch(matchRuleGroups({ groups: [rule({ categoryIds: [id('household')] })], tx: split }))).toEqual(
        { remainder: false, splitIds: ['s1'] },
      );
    });

    it('counts the whole transaction for a rule without categories', () => {
      const tagged = { ...split, tagIds: new Set(['vacation']) };

      expect(describeMatch(matchRuleGroups({ groups: [rule({ tagIds: [id('vacation')] })], tx: tagged }))).toEqual({
        remainder: true,
        splitIds: ['s1'],
      });
    });

    it('applies the transaction conditions of a category rule to its splits', () => {
      const groups = [rule({ categoryIds: [id('household')], tagIds: [id('vacation')] })];

      expect(matchRuleGroups({ groups, tx: split })).toBeNull();
      expect(describeMatch(matchRuleGroups({ groups, tx: { ...split, tagIds: new Set(['vacation']) } }))).toEqual({
        remainder: false,
        splitIds: ['s1'],
      });
    });

    it('has no remainder when the splits cover the whole amount', () => {
      const fullySplit = tx({ splits: [{ id: 's1', categoryId: id('household'), cents: 10_000 }] });

      expect(matchRuleGroups({ groups: [rule({ categoryIds: [id('groceries')] })], tx: fullySplit })).toBeNull();
    });

    it('counts parts matched by several rules once', () => {
      const groups = [rule({ categoryIds: [id('groceries')] }), rule({ accountIds: [id('card')] })];

      expect(describeMatch(matchRuleGroups({ groups, tx: split }))).toEqual({ remainder: true, splitIds: ['s1'] });
    });
  });

  it('ignores rules with no conditions', () => {
    expect(matchRuleGroups({ groups: [rule()], tx: tx() })).toBeNull();
  });
});

describe('getBudgetRuleGroups', () => {
  it('turns the categories of a budget without rules into one rule', () => {
    expect(getBudgetRuleGroups({ rules: null, categoryIds: [id('groceries')] })).toEqual([
      ruleGroupFromCategoryIds({ categoryIds: [id('groceries')] }),
    ]);
    expect(getBudgetRuleGroups({ rules: null, categoryIds: [] })).toEqual([]);
  });

  it('prefers stored rules and drops empty ones', () => {
    const tagRule = rule({ tagIds: [id('vacation')] });

    expect(getBudgetRuleGroups({ rules: [tagRule, rule()], categoryIds: [id('groceries')] })).toEqual([tagRule]);
  });
});
