import type {
  PortfolioActivityCashAmount,
  PortfolioActivityInvestmentItem,
  PortfolioActivityItem,
  PortfolioActivitySplitItem,
  PortfolioActivityTransferItem,
} from '@bt/shared/types/investments';
import { toUtcDateString } from '@common/utils/date';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import InvestmentTransaction from '@models/investments/investment-transaction.model';
import PortfolioBalances from '@models/investments/portfolio-balances.model';
import PortfolioTransfers from '@models/investments/portfolio-transfers.model';
import Portfolios from '@models/investments/portfolios.model';
import Securities from '@models/investments/securities.model';
import { loadSplitsBySecurity } from '@services/investments/splits/load-splits';
import { calculateCashDelta } from '@services/investments/transactions/cash-balance-utils';
import { Big } from 'big.js';
import { Op } from 'sequelize';

/** An item plus its creation time, which orders same-day rows. `balancesAfter` is filled in later. */
interface SortableItem {
  item: PortfolioActivityItem;
  createdAt: Date;
}

const toInvestmentItem = ({ tx }: { tx: InvestmentTransaction }): SortableItem => {
  const delta = calculateCashDelta({
    category: tx.category,
    settlementAmount: tx.settlementAmount.toDecimalString(10),
  });
  const item: PortfolioActivityInvestmentItem = {
    type: 'investment',
    id: tx.id,
    date: toUtcDateString(tx.date),
    category: tx.category,
    securitySymbol: tx.security?.symbol ?? null,
    securityName: tx.security?.name ?? null,
    quantity: tx.quantity.toDecimalString(10),
    price: tx.price.toDecimalString(10),
    cashChanges: delta === null ? [] : [{ currencyCode: tx.settlementCurrencyCode, amount: new Big(delta).toString() }],
    balancesAfter: [],
  };
  return { item, createdAt: tx.createdAt };
};

const toTransferItem = ({
  transfer,
  portfolioId,
}: {
  transfer: PortfolioTransfers;
  portfolioId: string;
}): SortableItem => {
  const isOut = transfer.fromPortfolioId === portfolioId;
  const isIn = transfer.toPortfolioId === portfolioId;
  const cashChanges: PortfolioActivityCashAmount[] = [];
  if (isOut)
    cashChanges.push({ currencyCode: transfer.currencyCode, amount: transfer.amount.toBig().times(-1).toString() });
  if (isIn) {
    cashChanges.push(
      transfer.toCurrencyCode && transfer.toAmount
        ? { currencyCode: transfer.toCurrencyCode, amount: transfer.toAmount.toBig().toString() }
        : { currencyCode: transfer.currencyCode, amount: transfer.amount.toBig().toString() },
    );
  }

  const otherSide = isIn
    ? { accountId: transfer.fromAccountId, portfolioId: transfer.fromPortfolioId }
    : { accountId: transfer.toAccountId, portfolioId: transfer.toPortfolioId };
  const item: PortfolioActivityTransferItem = {
    type: 'transfer',
    id: transfer.id,
    date: transfer.date,
    direction: isIn && isOut ? 'exchange' : isIn ? 'in' : 'out',
    counterparty: otherSide.accountId ? 'account' : otherSide.portfolioId ? 'portfolio' : 'external',
    isAdjustment: transfer.isAdjustment,
    description: transfer.description,
    cashChanges,
    balancesAfter: [],
  };
  return { item, createdAt: transfer.createdAt };
};

/**
 * Splits of the portfolio's securities from each one's first trade on. A split
 * takes effect at the open, before its day's trades, so it sorts below them.
 */
const toSplitItems = async ({ transactions }: { transactions: InvestmentTransaction[] }): Promise<SortableItem[]> => {
  const firstTradeBySecurity = new Map<string, InvestmentTransaction>();
  for (const tx of transactions) {
    const first = firstTradeBySecurity.get(tx.securityId);
    if (!first || tx.date < first.date) firstTradeBySecurity.set(tx.securityId, tx);
  }
  const splitsBySecurity = await loadSplitsBySecurity({ securityIds: [...firstTradeBySecurity.keys()] });

  return [...splitsBySecurity].flatMap(([securityId, splits]) => {
    const firstTrade = firstTradeBySecurity.get(securityId)!;
    return splits
      .filter((split) => split.date > toUtcDateString(firstTrade.date))
      .map((split) => {
        const item: PortfolioActivitySplitItem = {
          type: 'split',
          id: `${securityId}-${split.date}`,
          date: split.date,
          securitySymbol: firstTrade.security?.symbol ?? null,
          numerator: split.numerator,
          denominator: split.denominator,
          cashChanges: [],
          balancesAfter: [],
        };
        return { item, createdAt: new Date(0) };
      });
  });
};

/**
 * Every trade, dividend, fee, split and cash movement of a portfolio in one
 * newest-first list, each with the cash balance it left behind.
 *
 * Balances are anchored on the stored `PortfolioBalances`, like the combined
 * balance history's cash replay: the balance after a row is the stored balance
 * minus the cash changes of every newer row. The newest row therefore always
 * matches the portfolio's cash card, and a balance written without a row behind
 * it (an importer seed) shifts every earlier row by the same amount rather than
 * breaking the chain.
 */
export async function getPortfolioActivity({
  userId,
  portfolioId,
  limit,
  offset,
}: {
  userId: number;
  portfolioId: string;
  limit: number;
  offset: number;
}): Promise<{ data: PortfolioActivityItem[]; totalCount: number }> {
  await findOrThrowNotFound({
    query: Portfolios.findOne({ where: { id: portfolioId, userId } }),
    message: t({ key: 'investments.portfolioNotFound' }),
  });

  const [transactions, transfers, balances] = await Promise.all([
    InvestmentTransaction.findAll({
      where: { portfolioId },
      include: [{ model: Securities, attributes: ['symbol', 'name'] }],
    }),
    PortfolioTransfers.findAll({
      where: { userId, [Op.or]: [{ fromPortfolioId: portfolioId }, { toPortfolioId: portfolioId }] },
    }),
    PortfolioBalances.findAll({ where: { portfolioId } }),
  ]);

  const data = [
    ...transactions.map((tx) => toInvestmentItem({ tx })),
    ...transfers.map((transfer) => toTransferItem({ transfer, portfolioId })),
    ...(await toSplitItems({ transactions })),
  ]
    .toSorted((a, b) => b.item.date.localeCompare(a.item.date) || b.createdAt.getTime() - a.createdAt.getTime())
    .map(({ item }) => item);

  const running = new Map(balances.map((balance) => [balance.currencyCode, balance.totalCash.toBig()]));
  for (const item of data) {
    item.balancesAfter = item.cashChanges.map(({ currencyCode }) => ({
      currencyCode,
      amount: (running.get(currencyCode) ?? new Big(0)).toString(),
    }));
    for (const change of item.cashChanges) {
      running.set(change.currencyCode, (running.get(change.currencyCode) ?? new Big(0)).minus(change.amount));
    }
  }

  return { data: data.slice(offset, offset + limit), totalCount: data.length };
}
