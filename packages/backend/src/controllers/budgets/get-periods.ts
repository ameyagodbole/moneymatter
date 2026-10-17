import { dateBound, recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { serializeBudgetPeriods } from '@root/serializers';
import { getBudgetPeriods } from '@root/services/budgets/get-budget-periods';
import { z } from 'zod';

export default createController(
  z.object({
    params: z.object({
      id: recordId(),
    }),
    query: z
      .object({
        // The newest period returned is the one containing this instant (default now).
        at: dateBound({ precision: 'datetime' }).optional(),
        count: z.coerce.number().int().min(1).max(36).default(12),
      })
      .optional()
      .default({ count: 12 }),
  }),
  async ({ user, params, query }) => {
    const data = await getBudgetPeriods({
      userId: user.id,
      budgetId: params.id,
      at: query.at ? new Date(query.at) : undefined,
      count: query.count,
    });

    return { data: serializeBudgetPeriods(data) };
  },
);
