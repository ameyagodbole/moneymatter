import type { RecordId } from '@bt/shared/types';
import Categories from '@models/categories.model';
import { getUserDefaultCategory } from '@models/users.model';

export const LOAN_PAYMENT_CATEGORY_KEY = 'loan-interests';

/**
 * Category a loan payment's expense leg should carry. Stats count that leg as spend, but transfers
 * hide the category picker, so without this a payment stays uncategorized (dropped from category
 * stats) or in the default category it was imported with. A category the user picked is kept;
 * otherwise the seeded "Loan interests" category, falling back to the default when it was deleted.
 */
export const resolveLoanPaymentCategoryId = async ({
  userId,
  categoryId,
}: {
  userId: number;
  categoryId: RecordId | null;
}): Promise<RecordId | null> => {
  const defaultCategoryId = await getUserDefaultCategory({ id: userId });
  if (categoryId && categoryId !== defaultCategoryId) return categoryId;

  const loanCategory = await Categories.findOne({
    where: { userId, key: LOAN_PAYMENT_CATEGORY_KEY },
    attributes: ['id'],
  });

  return loanCategory?.id ?? defaultCategoryId ?? categoryId;
};
