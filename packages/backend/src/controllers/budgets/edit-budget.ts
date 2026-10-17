import { BUDGET_RECURRENCES } from '@bt/shared/types';
import { dateBound, decimalMoney, recordId, recordArrayIds, withDateOrder } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { serializeBudget } from '@root/serializers';
import * as editBudgetService from '@services/budgets/edit-budget';
import { z } from 'zod';

import { budgetRulesSchema } from './budget-rules-schema';
import { budgetTimezone } from './budget-timezone';

const schema = z.object({
  params: z.object({
    id: recordId(),
  }),
  body: withDateOrder(
    z.object({
      name: z.string().min(1, 'Name is required').max(200, 'Name must not exceed 200 characters').trim().optional(),
      categoryIds: recordArrayIds().optional(),
      rules: budgetRulesSchema().optional(),
      recurrence: z.nativeEnum(BUDGET_RECURRENCES).optional(),
      timezone: budgetTimezone().nullable().optional(),
      startDate: dateBound({ precision: 'datetime' }).optional(),
      // `null` clears the end date (a recurring budget then repeats until archived).
      endDate: dateBound({ precision: 'datetime' }).nullable().optional(),
      autoInclude: z.boolean().optional().default(false),
      limitAmount: decimalMoney()
        .refine((m) => m.isPositive(), { message: 'Limit amount must be positive' })
        .optional(),
    }),
    ['startDate', 'endDate'],
  ),
});

export default createController(schema, async ({ user, params, body }) => {
  const { name, categoryIds, rules, recurrence, timezone, startDate, endDate, limitAmount, autoInclude } = body;

  const budget = await editBudgetService.editBudget({
    id: params.id,
    userId: user.id,
    name,
    categoryIds,
    rules,
    recurrence,
    timezone,
    startDate,
    endDate,
    limitAmount,
    autoInclude,
  });

  // Serialize: convert cents to decimal for API response
  return { data: budget ? serializeBudget(budget) : null };
});
