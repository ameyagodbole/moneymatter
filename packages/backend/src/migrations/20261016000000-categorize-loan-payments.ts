import { QueryInterface } from 'sequelize';

/**
 * Loan payments count as spend in stats, but transfers never got a category picker: imported ones
 * kept the user's default category and hand-entered ones had none (so category stats dropped
 * them). Move every such leg to the seeded "Loan interests" category, or to the default category
 * when that one was deleted. Legs with a category the user picked are left alone.
 */
module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.query(`
      UPDATE "Transactions" t
      SET "categoryId" = COALESCE(
        (SELECT c."id" FROM "Categories" c WHERE c."userId" = t."userId" AND c."key" = 'loan-interests' LIMIT 1),
        u."defaultCategoryId"
      )
      FROM "Users" u
      WHERE u."id" = t."userId"
        AND t."transferNature" = 'transfer_to_loan'
        AND (t."categoryId" IS NULL OR t."categoryId" = u."defaultCategoryId");
    `);
  },

  down: async (): Promise<void> => {
    // Irreversible: the previous category (default or none) is not recorded. Nothing to undo
    // structurally, so rolling back is a no-op rather than a failure.
  },
};
