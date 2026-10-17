import { BUDGET_RECURRENCES, BUDGET_STATUSES, BUDGET_TYPES } from '@bt/shared/types';
import { dateBound, decimalMoney, recordArrayIds, withDateOrder } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { serializeBudget } from '@root/serializers';
import * as budgetsService from '@root/services/budgets/create-budget';
import { z } from 'zod';

import { budgetTimezone } from './budget-timezone';

const schema = z.object({
  body: withDateOrder(
    z
      .object({
        name: z.string().min(1, 'Name is required').max(200, 'The name must not exceed 200 characters').trim(),
        type: z.nativeEnum(BUDGET_TYPES).optional().default(BUDGET_TYPES.manual),
        recurrence: z.nativeEnum(BUDGET_RECURRENCES).optional().default(BUDGET_RECURRENCES.none),
        timezone: budgetTimezone().nullable().optional(),
        categoryIds: recordArrayIds().optional(),
        startDate: dateBound({ precision: 'datetime' }).nullable().optional(),
        endDate: dateBound({ precision: 'datetime' }).nullable().optional(),
        autoInclude: z.boolean().optional().default(false),
        limitAmount: decimalMoney()
          .refine((m) => m.isPositive(), { message: 'Limit amount must be positive' })
          .nullable()
          .optional(),
      })
      .refine((data) => data.recurrence === BUDGET_RECURRENCES.none || Boolean(data.startDate), {
        message: 'Recurring budgets require a start date',
        path: ['startDate'],
      })
      .refine((data) => data.type !== BUDGET_TYPES.category || (data.categoryIds && data.categoryIds.length > 0), {
        message: 'Category budgets require at least one category',
        path: ['categoryIds'],
      }),
    ['startDate', 'endDate'],
  ),
});

export default createController(schema, async ({ user, body }) => {
  const { id: userId } = user;
  const { name, type, recurrence, timezone, categoryIds, startDate, endDate, autoInclude, limitAmount } = body;

  const budget = await budgetsService.createBudget({
    name,
    userId,
    status: BUDGET_STATUSES.active,
    type,
    recurrence,
    timezone,
    categoryIds,
    startDate: startDate ? new Date(startDate) : undefined,
    endDate: endDate ? new Date(endDate) : undefined,
    autoInclude,
    limitAmount,
  });

  // Serialize: convert cents to decimal for API response
  return { data: serializeBudget(budget) };
});
