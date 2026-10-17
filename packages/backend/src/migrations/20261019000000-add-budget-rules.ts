import { DataTypes, QueryInterface, Transaction } from 'sequelize';

/**
 * Matching rules for automatic (`category`) budgets: an array of rule groups, each a set
 * of category / tag / account / payee conditions. Every existing category budget becomes
 * one rule holding its current categories, so it keeps matching exactly what it did.
 */
module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    const t: Transaction = await queryInterface.sequelize.transaction();

    try {
      await queryInterface.addColumn(
        'Budgets',
        'rules',
        { type: DataTypes.JSONB, allowNull: true, defaultValue: null },
        { transaction: t },
      );

      await queryInterface.sequelize.query(
        `
        UPDATE "Budgets" b
        SET "rules" = jsonb_build_array(
          jsonb_build_object(
            'categoryIds', COALESCE(
              (SELECT jsonb_agg(bc."categoryId") FROM "BudgetCategories" bc WHERE bc."budgetId" = b."id"),
              '[]'::jsonb
            ),
            'tagIds', '[]'::jsonb,
            'tagMatch', 'any',
            'accountIds', '[]'::jsonb,
            'payeeIds', '[]'::jsonb
          )
        )
        WHERE b."type" = 'category'
        `,
        { transaction: t },
      );

      await t.commit();
    } catch (error) {
      await t.rollback();
      throw error;
    }
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.removeColumn('Budgets', 'rules');
  },
};
