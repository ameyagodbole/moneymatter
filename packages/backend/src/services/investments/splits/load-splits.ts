import SecuritySplits from '@models/investments/security-splits.model';
import { Big } from 'big.js';
import { Op } from 'sequelize';

import type { SplitEvent } from './share-basis';

/** Splits of the given securities, keyed by security id. Securities without splits are absent. */
export async function loadSplitsBySecurity({
  securityIds,
}: {
  securityIds: string[];
}): Promise<Map<string, SplitEvent[]>> {
  const bySecurity = new Map<string, SplitEvent[]>();
  if (securityIds.length === 0) return bySecurity;

  const rows = await SecuritySplits.findAll({
    where: { securityId: { [Op.in]: [...new Set(securityIds)] } },
    attributes: ['securityId', 'date', 'numerator', 'denominator'],
    raw: true,
  });
  for (const { securityId, date, numerator, denominator } of rows) {
    const splits = bySecurity.get(securityId) ?? [];
    // DECIMAL columns come back padded ("4.0000000000"); Big drops the padding.
    splits.push({ date, numerator: new Big(numerator).toString(), denominator: new Big(denominator).toString() });
    bySecurity.set(securityId, splits);
  }
  return bySecurity;
}
