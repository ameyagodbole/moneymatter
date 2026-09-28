import { INVESTMENT_TRANSACTION_CATEGORY } from '@bt/shared/types/investments';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';

describe('GET /investments/portfolios/:id/activity', () => {
  it('lists trades and cash movements newest first with the cash balance after each', async () => {
    const portfolio = await helpers.createPortfolio({ payload: helpers.buildPortfolioPayload(), raw: true });
    const [aapl] = await helpers.seedSecurities([{ symbol: 'AAPL', name: 'Apple Inc.' }]);
    await helpers.createHolding({ payload: { portfolioId: portfolio.id, securityId: aapl!.id } });

    await helpers.directCashTransaction({
      portfolioId: portfolio.id,
      payload: { type: 'deposit', amount: '1000', currencyCode: 'USD', date: '2024-01-01', description: 'ACH deposit' },
    });
    await helpers.createInvestmentTransaction({
      payload: {
        portfolioId: portfolio.id,
        securityId: aapl!.id,
        category: INVESTMENT_TRANSACTION_CATEGORY.buy,
        date: '2024-01-02',
        quantity: '2',
        price: '100',
      },
    });
    await helpers.directCashTransaction({
      portfolioId: portfolio.id,
      payload: {
        type: 'withdrawal',
        amount: '3',
        currencyCode: 'USD',
        date: '2024-01-03',
        description: 'Platform fee',
        isAdjustment: true,
      },
    });

    const { data, pagination } = await helpers.getPortfolioActivity({ portfolioId: portfolio.id, raw: true });

    expect(pagination.totalCount).toBe(3);
    expect(
      data.map((item) => [
        item.type,
        item.date,
        Number(item.cashChanges[0]!.amount),
        Number(item.balancesAfter[0]!.amount),
      ]),
    ).toEqual([
      ['transfer', '2024-01-03', -3, 797],
      ['investment', '2024-01-02', -200, 800],
      ['transfer', '2024-01-01', 1000, 1000],
    ]);
    expect(data[0]).toMatchObject({ direction: 'out', counterparty: 'external', isAdjustment: true });
    expect(data[1]).toMatchObject({ category: INVESTMENT_TRANSACTION_CATEGORY.buy, securitySymbol: 'AAPL' });

    const page = await helpers.getPortfolioActivity({ portfolioId: portfolio.id, limit: 1, offset: 1, raw: true });
    expect(page.data.map((item) => item.id)).toEqual([data[1]!.id]);
  });

  it('returns an empty list for a portfolio without activity', async () => {
    const portfolio = await helpers.createPortfolio({ payload: helpers.buildPortfolioPayload(), raw: true });

    const { data, pagination } = await helpers.getPortfolioActivity({ portfolioId: portfolio.id, raw: true });

    expect(data).toEqual([]);
    expect(pagination.totalCount).toBe(0);
  });

  it('returns 404 for a portfolio the user does not own', async () => {
    const response = await helpers.getPortfolioActivity({ portfolioId: generateRandomRecordId() });

    expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
  });
});
