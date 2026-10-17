import { isValidTimezone } from '@common/utils/zoned-time';
import { z } from 'zod';

/** IANA zone stored on the budget; periods are cut at local midnight in it. */
export const budgetTimezone = () =>
  z
    .string()
    .max(64)
    .refine((timezone) => isValidTimezone({ timezone }), { message: 'Unknown IANA timezone' });
