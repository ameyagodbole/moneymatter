import { BUDGET_TYPES, SHARE_PERMISSIONS } from '@bt/shared/types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import BudgetExcludedTransactions from '@models/budget-excluded-transactions.model';
import BudgetTransactions from '@models/budget-transactions.model';
import Budgets from '@models/budget.model';
import { findTransactions } from '@models/transactions-query';
import { withTransaction } from '@services/common/with-transaction';
import { Op } from 'sequelize';

import { authorizeBudgetAccess } from './authorize-budget-access';

interface ExcludedTransactionsPayload {
  budgetId: string;
  userId: number;
  transactionIds: string[];
}

/**
 * Exclusions change what a budget counts, so they take `manage`, like editing its
 * categories. Only category budgets have matches to exclude; a manual budget counts
 * exactly what is linked, so you unlink instead.
 */
const loadCategoryBudget = async ({ budgetId, userId }: { budgetId: string; userId: number }) => {
  const { ownerUserId } = await authorizeBudgetAccess({
    userId,
    budgetId,
    requiredPermission: SHARE_PERMISSIONS.manage,
  });

  const budget = await findOrThrowNotFound({
    query: Budgets.findOne({ where: { id: budgetId, userId: ownerUserId } }),
    message: t({ key: 'budgets.budgetNotFound' }),
  });

  if (budget.type !== BUDGET_TYPES.category) {
    throw new ValidationError({ message: t({ key: 'budgets.exclusionsOnlyForCategoryBudgets' }) });
  }

  return { budget, ownerUserId };
};

/** Takes transactions the budget's categories match out of the budget. Also drops any hand link to them. */
export const excludeTransactionsFromBudget = withTransaction(
  async ({ budgetId, userId, transactionIds }: ExcludedTransactionsPayload) => {
    const { ownerUserId } = await loadCategoryBudget({ budgetId, userId });

    // Matches are the owner's transactions, so only those can be excluded.
    const transactions = await findTransactions({
      planned: 'include',
      access: { creator: ownerUserId },
      balanceAdjustments: 'include',
      completeness: 'all',
      where: { id: { [Op.in]: transactionIds } },
      attributes: ['id'],
    });

    if (transactions.length !== transactionIds.length) {
      throw new ValidationError({ message: t({ key: 'budgets.someTransactionIdsInvalid' }) });
    }

    await BudgetTransactions.destroy({ where: { budgetId, transactionId: { [Op.in]: transactionIds } } });
    await BudgetExcludedTransactions.bulkCreate(
      transactionIds.map((transactionId) => ({ budgetId, transactionId })),
      { ignoreDuplicates: true },
    );

    return { excludedCount: transactionIds.length };
  },
);

/** Puts excluded transactions back, so the budget's categories count them again. */
export const restoreExcludedTransactions = withTransaction(
  async ({ budgetId, userId, transactionIds }: ExcludedTransactionsPayload) => {
    await loadCategoryBudget({ budgetId, userId });

    const restoredCount = await BudgetExcludedTransactions.destroy({
      where: { budgetId, transactionId: { [Op.in]: transactionIds } },
    });

    return { restoredCount };
  },
);
