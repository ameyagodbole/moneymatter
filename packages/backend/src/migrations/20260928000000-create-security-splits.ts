import { DataTypes, QueryInterface } from 'sequelize';

/**
 * `SecuritySplits` — stock splits per security (see docs/specifications/stock-splits.md).
 * One row per (security, date); the ratio is `numerator / denominator` new shares per
 * old share. Quantities are converted with these when share counts are rebuilt.
 */
module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'SecuritySplits',
        {
          id: {
            type: DataTypes.UUID,
            primaryKey: true,
            allowNull: false,
          },
          securityId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: { model: 'Securities', key: 'id' },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE',
          },
          date: {
            type: DataTypes.DATEONLY,
            allowNull: false,
          },
          numerator: {
            type: DataTypes.DECIMAL(20, 10),
            allowNull: false,
          },
          denominator: {
            type: DataTypes.DECIMAL(20, 10),
            allowNull: false,
          },
          source: {
            type: DataTypes.STRING(16),
            allowNull: false,
          },
          createdAt: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
          },
          updatedAt: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
          },
        },
        { transaction },
      );

      await queryInterface.addIndex('SecuritySplits', ['securityId', 'date'], {
        unique: true,
        name: 'security_splits_security_id_date_unique',
        transaction,
      });
    });
  },

  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable('SecuritySplits', { transaction });
    });
  },
};
