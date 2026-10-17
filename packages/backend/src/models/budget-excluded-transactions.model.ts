import { RecordId } from '@bt/shared/types';
import Budgets from '@models/budget.model';
import { Table, Column, Model, ForeignKey, DataType } from 'sequelize-typescript';

import Transactions from './transactions.model';

/**
 * Transactions a category budget's rules match but the user excluded by hand. A
 * separate table from `BudgetTransactions`, whose rows every reader treats as
 * "in the budget".
 */
@Table({ tableName: 'BudgetExcludedTransactions', timestamps: false })
export default class BudgetExcludedTransactions extends Model {
  // `references` is declared on the columns because no association sets it here, and the
  // backup restore guard reads it to know which ids must belong to the restoring user.
  @ForeignKey(() => Budgets)
  @Column({ primaryKey: true, allowNull: false, type: DataType.UUID, references: { model: 'Budgets', key: 'id' } })
  budgetId!: RecordId;

  @ForeignKey(() => Transactions)
  @Column({
    primaryKey: true,
    allowNull: false,
    type: DataType.UUID,
    references: { model: 'Transactions', key: 'id' },
  })
  transactionId!: RecordId;
}
