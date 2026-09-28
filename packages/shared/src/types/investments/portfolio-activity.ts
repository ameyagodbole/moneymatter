import type { INVESTMENT_TRANSACTION_CATEGORY } from './enums';

/** A signed cash amount in one currency (decimal string). */
export interface PortfolioActivityCashAmount {
  currencyCode: string;
  amount: string;
}

interface PortfolioActivityItemBase {
  id: string;
  /** YYYY-MM-DD. */
  date: string;
  /** Cash each currency gained (positive) or lost (negative) through this row. Empty when no cash moved. */
  cashChanges: PortfolioActivityCashAmount[];
  /** The portfolio's cash in each currency of `cashChanges` right after this row. */
  balancesAfter: PortfolioActivityCashAmount[];
}

/** A trade, dividend, fee, tax or other row tied to a security. */
export interface PortfolioActivityInvestmentItem extends PortfolioActivityItemBase {
  type: 'investment';
  category: INVESTMENT_TRANSACTION_CATEGORY;
  securitySymbol: string | null;
  securityName: string | null;
  quantity: string;
  price: string;
}

/** A cash movement of the portfolio as a whole. */
export interface PortfolioActivityTransferItem extends PortfolioActivityItemBase {
  type: 'transfer';
  /** `exchange` is a currency conversion inside the portfolio. */
  direction: 'in' | 'out' | 'exchange';
  /** Where the money came from or went: outside the app, an account, or another portfolio. */
  counterparty: 'external' | 'account' | 'portfolio';
  isAdjustment: boolean;
  description: string | null;
}

export type PortfolioActivityItem = PortfolioActivityInvestmentItem | PortfolioActivityTransferItem;
