import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import * as payeesService from '@services/payees';
import { z } from 'zod';

import { serializePayee } from './serializer';

const schema = z.object({
  body: z.object({
    sourcePayeeIds: z.array(recordId()).min(1).max(payeesService.MAX_BULK_MERGE_SOURCES),
    targetPayeeId: recordId(),
    defaultCategoryId: recordId().nullable().optional(),
  }),
});

/**
 * POST /payees/merge
 *
 * Merges every source Payee into the target in one transaction and returns
 * the surviving Payee.
 */
export default createController(schema, async ({ user, body }) => {
  const target = await payeesService.bulkMergePayees({
    userId: user.id,
    sourceIds: body.sourcePayeeIds,
    targetId: body.targetPayeeId,
    defaultCategoryId: body.defaultCategoryId,
  });
  return { data: serializePayee(target) };
});
