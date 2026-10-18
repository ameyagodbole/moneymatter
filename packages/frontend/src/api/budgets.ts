import { api } from '@/api/_api';
import { BUDGET_RECURRENCES, BUDGET_ROLLOVERS, BudgetModel, endpointsTypes } from '@bt/shared/types';

interface editBudgetParamsParams {
  name?: string;
  limitAmount?: number;
  categoryIds?: string[];
  recurrence?: BUDGET_RECURRENCES;
  rollover?: BUDGET_ROLLOVERS;
  timezone?: string | null;
  startDate?: string;
  /** `null` clears the end date, so a recurring budget repeats until archived. */
  endDate?: string | null;
}

/** `at` query for recurring budgets: the instant whose period to read. Omitted means now. */
const atQuery = (at: Date | undefined) => (at ? { at: at.toISOString() } : {});

export const loadSystemBudgets = async ({ status }: { status?: string } = {}): Promise<BudgetModel[]> => {
  return api.get('/budgets', status ? { status } : undefined);
};

export const loadBudgetById = async (id: string): Promise<BudgetModel> => {
  return api.get(`/budgets/${id}`);
};

export const createBudget = async (payload: Omit<BudgetModel, 'id' | 'userId'>): Promise<BudgetModel> => {
  const params = {
    ...payload,
    limitAmount: payload.limitAmount && payload.limitAmount > 0 ? payload.limitAmount : null,
  };
  return api.post('/budgets', params);
};

export const deleteBudget = async (budgetId: string) => api.delete(`/budgets/${budgetId}`);

export const archiveBudget = async ({ budgetId, isArchived }: { budgetId: string; isArchived: boolean }) =>
  api.patch(`/budgets/${budgetId}/archive`, { isArchived });

export const editBudget = async ({ budgetId, payload }: { budgetId: string; payload: editBudgetParamsParams }) => {
  await api.put(`/budgets/${budgetId}`, payload);
};

export const addTransactionsToBudget = async (budgetId: string, params: Record<string, unknown>) =>
  api.post(`/budgets/${budgetId}/transactions`, params);

export const removeTransactionsFromBudget = async ({
  budgetId,
  payload,
}: {
  budgetId: string;
  payload: { transactionIds: string[] };
}) => api.delete(`/budgets/${budgetId}/transactions`, { data: payload });

export interface BudgetPeriod {
  index: number;
  /** ISO instant */
  start: string;
  /** ISO instant, last millisecond of the period */
  end: string;
}

export interface StatsResponse {
  /** The period the totals cover, or null for one-off budgets. */
  period: BudgetPeriod | null;
  summary: {
    actualIncome: number;
    actualExpense: number;
    balance: number; // Net difference
    utilizationRate: null | number; // Percentage used (0-100)
    transactionsCount: number;
    firstTransactionDate: string | null; // ISO date string of earliest transaction
    lastTransactionDate: string | null; // ISO date string of latest transaction
    /** The limit this period is measured against, rollover included. Null without a limit. */
    limitAmount: number | null;
    /** What the previous period carried in; negative when overspending was taken off. */
    rolledOverAmount: number;
  };
}

export const loadBudgetStats = async ({ budgetId, at }: { budgetId: string; at?: Date }): Promise<StatsResponse> => {
  return api.get(`/budgets/${budgetId}/stats`, atQuery(at));
};

export interface BudgetPeriodTotals {
  index: number;
  periodStart: string;
  periodEnd: string;
  expense: number;
  income: number;
  /** Net outflow, never below zero: what the limit is compared against. */
  spent: number;
  limitAmount: number | null;
  utilizationRate: number | null;
}

export interface BudgetCumulativeStep {
  /** 1-based position inside the period */
  step: number;
  stepStart: string;
  /** Running net spending up to the end of this step */
  value: number;
  /** Net spending within this step alone */
  periodValue: number;
}

export interface BudgetPeriodsResponse {
  recurrence: Exclude<BUDGET_RECURRENCES, BUDGET_RECURRENCES.none>;
  /** Oldest first, ending with the period containing `at` */
  periods: BudgetPeriodTotals[];
  cumulative: {
    granularity: 'day' | 'week' | 'month';
    current: BudgetCumulativeStep[];
    /** Empty when the selected period is the first one */
    previous: BudgetCumulativeStep[];
  };
}

export const loadBudgetPeriods = async ({
  budgetId,
  at,
  count,
}: {
  budgetId: string;
  at?: Date;
  count?: number;
}): Promise<BudgetPeriodsResponse> => {
  return api.get(`/budgets/${budgetId}/periods`, { ...atQuery(at), ...(count && { count }) });
};

export interface CategoryBudgetTransaction {
  id: string;
  time: string;
  transactionType: 'income' | 'expense';
  refAmount: number;
  amount: number;
  note: string | null;
  categoryId: string | null;
  accountId: string;
  effectiveCategory?: {
    id: string;
    name: string;
    color: string;
  };
  effectiveRefAmount?: number;
  /** Matched by the budget's categories, or linked by hand. */
  source: 'rule' | 'linked';
}

/** A transaction the budget's categories match but that was excluded by hand. */
export interface ExcludedBudgetTransaction {
  id: string;
  time: string;
  transactionType: 'income' | 'expense';
  refAmount: number;
  note: string | null;
  accountId: string;
  category?: { id: string; name: string; color: string };
}

interface CategoryBudgetTransactionsResponse {
  transactions: CategoryBudgetTransaction[];
  total: number;
  /** Excluded transactions within the same period. */
  excluded: ExcludedBudgetTransaction[];
}

export const excludeTransactionsFromBudget = async ({
  budgetId,
  transactionIds,
}: {
  budgetId: string;
  transactionIds: string[];
}): Promise<{ excludedCount: number }> => api.post(`/budgets/${budgetId}/excluded-transactions`, { transactionIds });

export const restoreExcludedTransactions = async ({
  budgetId,
  transactionIds,
}: {
  budgetId: string;
  transactionIds: string[];
}): Promise<{ restoredCount: number }> =>
  api.delete(`/budgets/${budgetId}/excluded-transactions`, { data: { transactionIds } });

export const loadCategoryBudgetTransactions = async ({
  budgetId,
  from = 0,
  limit = 50,
  at,
}: {
  budgetId: string;
  from?: number;
  limit?: number;
  at?: Date;
}): Promise<CategoryBudgetTransactionsResponse> => {
  return api.get(`/budgets/${budgetId}/category-transactions`, { from, limit, ...atQuery(at) });
};

export const loadBudgetSpendingStats = async ({
  budgetId,
  at,
}: {
  budgetId: string;
  at?: Date;
}): Promise<endpointsTypes.BudgetSpendingStatsResponse> => {
  return api.get(`/budgets/${budgetId}/spending-stats`, atQuery(at));
};
