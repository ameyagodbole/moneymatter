import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { excludeTransactionsFromBudget, restoreExcludedTransactions } from '@services/budgets/excluded-transactions';
import { z } from 'zod';

const schema = z.object({
  params: z.object({
    id: recordId(),
  }),
  body: z.object({
    transactionIds: z
      .array(recordId())
      .min(1, { message: 'At least one transaction ID is required' })
      .refine((ids) => new Set(ids).size === ids.length, {
        message: 'Transaction IDs must be unique',
      }),
  }),
});

export const excludeTransactions = createController(schema, async ({ user, params, body }) => {
  const data = await excludeTransactionsFromBudget({
    budgetId: params.id,
    userId: user.id,
    transactionIds: body.transactionIds,
  });

  return { data };
});

export const restoreTransactions = createController(schema, async ({ user, params, body }) => {
  const data = await restoreExcludedTransactions({
    budgetId: params.id,
    userId: user.id,
    transactionIds: body.transactionIds,
  });

  return { data };
});
