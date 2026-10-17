import { DataTypes, QueryInterface, Transaction } from 'sequelize';

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    const t: Transaction = await queryInterface.sequelize.transaction();

    try {
      // `none | monthly | quarterly | yearly`. A string rather than a Postgres enum so new
      // cadences don't need the ALTER TYPE dance the status enum needed.
      await queryInterface.addColumn(
        'Budgets',
        'recurrence',
        { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'none' },
        { transaction: t },
      );

      // IANA zone the periods are cut in, captured from the browser on create/edit.
      await queryInterface.addColumn(
        'Budgets',
        'timezone',
        { type: DataTypes.STRING(64), allowNull: true, defaultValue: null },
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
      await queryInterface.removeColumn('Budgets', 'timezone', { transaction: t });
      await queryInterface.removeColumn('Budgets', 'recurrence', { transaction: t });
      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
  },
};
