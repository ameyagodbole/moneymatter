import { RecordId } from '@bt/shared/types';
import { IdColumn } from '@common/types/id-column';
import { BelongsTo, Column, DataType, ForeignKey, Model, Table } from 'sequelize-typescript';

import Securities from './securities.model';

export const SECURITY_SPLIT_SOURCE = {
  provider: 'provider',
  manual: 'manual',
} as const;
export type SecuritySplitSource = (typeof SECURITY_SPLIT_SOURCE)[keyof typeof SECURITY_SPLIT_SOURCE];

/**
 * A stock split of a security: from `date` (the ex-date) each share became
 * `numerator / denominator` shares. See docs/specifications/stock-splits.md.
 */
@Table({
  timestamps: true,
  tableName: 'SecuritySplits',
  indexes: [{ unique: true, fields: ['securityId', 'date'], name: 'security_splits_security_id_date_unique' }],
})
export default class SecuritySplits extends Model {
  @Column(IdColumn())
  declare id: RecordId;

  @ForeignKey(() => Securities)
  @Column({ type: DataType.UUID, allowNull: false })
  securityId!: RecordId;

  @BelongsTo(() => Securities)
  security?: Securities;

  /** YYYY-MM-DD. Trades on this date are already in post-split shares. */
  @Column({ type: DataType.DATEONLY, allowNull: false })
  date!: string;

  @Column({ type: DataType.DECIMAL(20, 10), allowNull: false })
  numerator!: string;

  @Column({ type: DataType.DECIMAL(20, 10), allowNull: false })
  denominator!: string;

  @Column({ type: DataType.STRING(16), allowNull: false })
  source!: SecuritySplitSource;
}
