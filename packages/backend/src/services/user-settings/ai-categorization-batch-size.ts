import { AI_CATEGORIZATION_DEFAULT_BATCH_SIZE, type AiCategorizationBatchSize } from '@bt/shared/types';
import UserSettings from '@models/user-settings.model';

/** Transactions per model request in the user's categorization runs. */
export const getCategorizationBatchSize = async ({
  userId,
}: {
  userId: number;
}): Promise<AiCategorizationBatchSize> => {
  const userSettings = await UserSettings.findOne({ where: { userId }, attributes: ['settings'] });

  return userSettings?.settings?.ai?.categorizationBatchSize ?? AI_CATEGORIZATION_DEFAULT_BATCH_SIZE;
};
