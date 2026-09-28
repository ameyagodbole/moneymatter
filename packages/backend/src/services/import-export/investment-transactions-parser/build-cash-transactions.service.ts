import type { InvestmentImportCashTransaction } from '@bt/shared/types/investments';
import PortfolioTransfers from '@models/investments/portfolio-transfers.model';
import { Big } from 'big.js';
import { Op } from 'sequelize';
import { v4 as uuidv4 } from 'uuid';

import type { ParsedCashRow } from './csv-parser.service';

/**
 * Turn parsed cash rows into reviewable cash transactions, flagging the ones an
 * earlier import (or a manual entry) already recorded.
 *
 * A row repeats an existing direct deposit/withdrawal of the same portfolio on
 * the same day, in the same direction, currency and amount. Each existing
 * transfer matches at most one row: a file with two identical same-day deposits
 * must still offer the second one when only one is on record.
 */
export async function buildCashTransactions({
  userId,
  portfolioId,
  rows,
}: {
  userId: number;
  portfolioId: string;
  rows: ParsedCashRow[];
}): Promise<InvestmentImportCashTransaction[]> {
  if (rows.length === 0) return [];

  const dates = rows.map((row) => row.date).toSorted();
  const existing = await PortfolioTransfers.findAll({
    where: {
      userId,
      fromAccountId: null,
      toAccountId: null,
      date: { [Op.between]: [dates[0]!, dates[dates.length - 1]!] },
      [Op.or]: [
        { toPortfolioId: portfolioId, fromPortfolioId: null },
        { fromPortfolioId: portfolioId, toPortfolioId: null },
      ],
    },
    attributes: ['id', 'date', 'amount', 'currencyCode', 'toPortfolioId'],
  });

  const unmatched = [...existing];
  return rows.map((row) => {
    const isDeposit = new Big(row.amount).gt(0);
    const magnitude = new Big(row.amount).abs();
    const matchIndex = unmatched.findIndex(
      (transfer) =>
        transfer.date === row.date &&
        transfer.currencyCode === row.currencyCode &&
        (transfer.toPortfolioId === portfolioId) === isDeposit &&
        transfer.amount.toBig().eq(magnitude),
    );
    const [match] = matchIndex === -1 ? [] : unmatched.splice(matchIndex, 1);

    return {
      tempId: uuidv4(),
      portfolioId,
      date: row.date,
      kind: row.kind,
      amount: row.amount,
      currencyCode: row.currencyCode,
      description: row.description,
      possibleDuplicateOf: match?.id ?? null,
    };
  });
}
