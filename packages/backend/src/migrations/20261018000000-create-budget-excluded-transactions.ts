import { DataTypes, QueryInterface, Transaction } from 'sequelize';

/**
 * Transactions a category budget's rules match but the user took out by hand.
 *
 * Kept apart from `BudgetTransactions` on purpose: every reader of that table (the
 * transactions list's budget filter, transaction detail, data export, bank sync) treats
 * a row as "this transaction is in the budget". An exclusion is the opposite.
 */
module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    const t: Transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.createTable(
        'BudgetExcludedTransactions',
        {
          budgetId: {
            type: DataTypes.UUID,
            allowNull: false,
            primaryKey: true,
            references: { model: 'Budgets', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          transactionId: {
            type: DataTypes.UUID,
            allowNull: false,
            primaryKey: true,
            references: { model: 'Transactions', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
        },
        { transaction: t },
      );

      await queryInterface.addIndex('BudgetExcludedTransactions', ['transactionId'], {
        name: 'budget_excluded_transactions_transaction_id_idx',
        transaction: t,
      });

      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.dropTable('BudgetExcludedTransactions');
  },
};
