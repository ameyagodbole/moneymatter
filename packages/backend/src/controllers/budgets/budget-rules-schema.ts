import { recordArrayIds } from '@common/lib/zod/custom-types';
import { z } from 'zod';

/** Upper bound on rules per budget: plenty for real use, and keeps the matching query small. */
const MAX_RULE_GROUPS = 20;

/** One rule of an automatic budget. Omitted lists mean "any". See `BudgetRuleGroup`. */
const budgetRuleGroupSchema = z.object({
  categoryIds: recordArrayIds().default([]),
  tagIds: recordArrayIds().default([]),
  tagMatch: z.enum(['any', 'all']).default('any'),
  accountIds: recordArrayIds().default([]),
  payeeIds: recordArrayIds().default([]),
});

export const budgetRulesSchema = () => z.array(budgetRuleGroupSchema).min(1).max(MAX_RULE_GROUPS);
