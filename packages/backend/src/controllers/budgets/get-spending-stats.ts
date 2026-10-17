import { dateBound, recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { serializeBudgetSpendingStats } from '@root/serializers';
import { getBudgetSpendingStats } from '@root/services/budgets/spending-stats';
import { z } from 'zod';

export default createController(
  z.object({
    params: z.object({
      id: recordId(),
    }),
    query: z
      .object({
        // Recurring budgets report the period containing this instant (default now).
        at: dateBound({ precision: 'datetime' }).optional(),
      })
      .optional()
      .default({}),
  }),
  async ({ user, params, query }) => {
    const stats = await getBudgetSpendingStats({
      userId: user.id,
      budgetId: params.id,
      at: query.at ? new Date(query.at) : undefined,
    });

    return { data: serializeBudgetSpendingStats(stats) };
  },
);
