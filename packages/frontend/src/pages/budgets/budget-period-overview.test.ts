import type { StatsResponse } from '@/api/budgets';
import { BUDGET_RECURRENCES, BUDGET_STATUSES, type RecordId } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { buildPeriodOverview } from './budget-period-overview';

const stats = ({ spent, limit }: { spent: number; limit: number | null }): StatsResponse => ({
  period: null,
  summary: {
    actualIncome: 0,
    actualExpense: spent,
    balance: -spent,
    utilizationRate: null,
    transactionsCount: 1,
    firstTransactionDate: null,
    lastTransactionDate: null,
    limitAmount: limit,
    rolledOverAmount: 0,
  },
});

const budget = (
  id: string,
  recurrence: BUDGET_RECURRENCES,
  extra: { status?: BUDGET_STATUSES; endDate?: Date } = {},
) => ({
  id: id as RecordId,
  status: extra.status ?? BUDGET_STATUSES.active,
  recurrence,
  endDate: extra.endDate,
});

describe('buildPeriodOverview', () => {
  const now = new Date('2026-10-17T12:00:00Z');

  it('adds up each cadence separately and counts budgets over their limit', () => {
    const byId: Record<string, StatsResponse> = {
      groceries: stats({ spent: 450, limit: 500 }),
      dining: stats({ spent: 260, limit: 200 }),
      insurance: stats({ spent: 900, limit: 1200 }),
    };

    const overview = buildPeriodOverview({
      budgets: [
        budget('insurance', BUDGET_RECURRENCES.yearly),
        budget('groceries', BUDGET_RECURRENCES.monthly),
        budget('dining', BUDGET_RECURRENCES.monthly),
      ],
      getStats: (id) => byId[id] ?? null,
      now,
    });

    expect(overview).toEqual([
      { recurrence: BUDGET_RECURRENCES.monthly, budgetsCount: 2, spent: 710, limit: 700, overLimitCount: 1 },
      { recurrence: BUDGET_RECURRENCES.yearly, budgetsCount: 1, spent: 900, limit: 1200, overLimitCount: 0 },
    ]);
  });

  it('leaves out one-off, archived, ended, limitless and not-yet-loaded budgets', () => {
    const byId: Record<string, StatsResponse> = {
      oneOff: stats({ spent: 10, limit: 100 }),
      archived: stats({ spent: 10, limit: 100 }),
      ended: stats({ spent: 10, limit: 100 }),
      limitless: stats({ spent: 10, limit: null }),
    };

    const overview = buildPeriodOverview({
      budgets: [
        budget('oneOff', BUDGET_RECURRENCES.none),
        budget('archived', BUDGET_RECURRENCES.monthly, { status: BUDGET_STATUSES.archived }),
        budget('ended', BUDGET_RECURRENCES.monthly, { endDate: new Date('2026-06-30T00:00:00Z') }),
        budget('limitless', BUDGET_RECURRENCES.monthly),
        budget('loading', BUDGET_RECURRENCES.monthly),
      ],
      getStats: (id) => byId[id] ?? null,
      now,
    });

    expect(overview).toEqual([]);
  });
});
