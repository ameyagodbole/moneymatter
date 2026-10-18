import { DataTypes, QueryInterface, Transaction } from 'sequelize';

/**
 * `rollover`: what a recurring budget carries into its next period (`none | surplus | all`).
 * `alertState`: which limit alerts were already sent, and for which period, so the hourly
 * check notifies once per threshold per period.
 */
module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    const t: Transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.addColumn(
        'Budgets',
        'rollover',
        { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'none' },
        { transaction: t },
      );
      await queryInterface.addColumn(
        'Budgets',
        'alertState',
        { type: DataTypes.JSONB, allowNull: true, defaultValue: null },
        { transaction: t },
      );
      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    const t: Transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.removeColumn('Budgets', 'alertState', { transaction: t });
      await queryInterface.removeColumn('Budgets', 'rollover', { transaction: t });
      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
  },
};
