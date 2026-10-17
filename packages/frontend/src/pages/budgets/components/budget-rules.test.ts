import type { CategoryModel, RecordId } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { createEmptyRule, getEditableRules, getSavableRules, isRuleEmpty } from './budget-rules';

const id = (value: string) => value as RecordId;

describe('budget rules helpers', () => {
  it('treats a rule with no conditions as empty', () => {
    expect(isRuleEmpty({ rule: createEmptyRule() })).toBe(true);
    expect(isRuleEmpty({ rule: { ...createEmptyRule(), payeeIds: [id('p1')] } })).toBe(false);
  });

  it('edits stored rules as copies', () => {
    const stored = [{ ...createEmptyRule(), tagIds: [id('t1')] }];
    const editable = getEditableRules({ budget: { rules: stored, categories: [] } });

    expect(editable).toEqual(stored);
    expect(editable[0]).not.toBe(stored[0]);
  });

  it('turns the categories of an older budget into one rule', () => {
    const categories = [{ id: id('c1') }, { id: id('c2') }] as CategoryModel[];

    expect(getEditableRules({ budget: { rules: null, categories } })).toEqual([
      { ...createEmptyRule(), categoryIds: [id('c1'), id('c2')] },
    ]);
  });

  it('only sends rules with conditions', () => {
    const tagRule = { ...createEmptyRule(), tagIds: [id('t1')] };

    expect(getSavableRules({ rules: [createEmptyRule(), tagRule] })).toEqual([tagRule]);
  });
});
