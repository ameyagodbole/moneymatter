/**
 * Budget Serializers
 *
 * Serializes budget model instances for API responses.
 * Money fields auto-convert via .toNumber().
 * Deserializers convert API decimal inputs to Money.
 */
import { BUDGET_RECURRENCES, BUDGET_TYPES, type BudgetRuleGroup, ResourceShareInfo } from '@bt/shared/types';
import { Money, centsToApiDecimal, centsToApiDecimalOrNull } from '@common/types/money';
import type Budgets from '@models/budget.model';
import type { BudgetShareContext } from '@services/sharing/get-shared-budgets.service';

// ============================================================================
// Response Types
// ============================================================================

interface BudgetCategoryResponse {
  id: string;
  name: string;
  color: string;
  parentId: string | null;
}

interface BudgetApiResponse {
  id: string;
  userId: number;
  name: string;
  status: string;
  type: BUDGET_TYPES;
  recurrence: BUDGET_RECURRENCES;
  timezone: string | null;
  startDate: Date | null;
  endDate: Date | null;
  autoInclude: boolean;
  limitAmount: number | null;
  categories: BudgetCategoryResponse[];
  /** Matching rules of an automatic budget; null for manual budgets. */
  rules: BudgetRuleGroup[] | null;
  /** Present on user-facing list/detail responses when share context is attached. */
  share?: ResourceShareInfo;
}

// ============================================================================
// Serializers (DB → API)
// ============================================================================

/**
 * Serialize a budget from DB format to API response
 */
export function serializeBudget(budget: Budgets & { _shareContext?: BudgetShareContext }): BudgetApiResponse {
  const categories: BudgetCategoryResponse[] = (budget.categories || []).map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    parentId: c.parentId,
  }));

  const response: BudgetApiResponse = {
    id: budget.id,
    userId: budget.userId,
    name: budget.name,
    status: budget.status,
    type: budget.type,
    recurrence: budget.recurrence,
    timezone: budget.timezone,
    startDate: budget.startDate,
    endDate: budget.endDate,
    autoInclude: budget.autoInclude,
    limitAmount: centsToApiDecimalOrNull(budget.limitAmount),
    categories,
    rules: budget.rules,
  };

  if (budget._shareContext) {
    response.share = {
      isOwner: budget._shareContext.isOwner,
      owner: budget._shareContext.owner,
      permission: budget._shareContext.permission,
      policy: budget._shareContext.policy,
      accessSource: budget._shareContext.accessSource,
    };
  }

  return response;
}

/**
 * Serialize multiple budgets
 */
export function serializeBudgets(
  budgets: Array<Budgets & { _shareContext?: BudgetShareContext }>,
): BudgetApiResponse[] {
  return budgets.map(serializeBudget);
}

// ============================================================================
// Budget Stats Serializer
// ============================================================================

interface BudgetStatsPeriod {
  index: number;
  start: Date;
  end: Date;
}

interface BudgetStatsApiResponse {
  /** The period the totals cover, or null for one-off budgets. */
  period: BudgetStatsPeriod | null;
  summary: {
    actualIncome: number;
    actualExpense: number;
    balance: number;
    utilizationRate: number | null;
    transactionsCount: number;
    firstTransactionDate: string | null;
    lastTransactionDate: string | null;
  };
}

interface BudgetStatsInternal {
  period: BudgetStatsPeriod | null;
  summary: {
    actualIncome: number | Money;
    actualExpense: number | Money;
    balance: number | Money;
    utilizationRate: number | null;
    transactionsCount: number;
    firstTransactionDate: string | null;
    lastTransactionDate: string | null;
  };
}

/**
 * Serialize budget stats to API decimal format
 */
export function serializeBudgetStats(stats: BudgetStatsInternal): BudgetStatsApiResponse {
  return {
    period: stats.period,
    summary: {
      actualIncome: centsToApiDecimal(stats.summary.actualIncome),
      actualExpense: centsToApiDecimal(stats.summary.actualExpense),
      balance: centsToApiDecimal(stats.summary.balance),
      utilizationRate: stats.summary.utilizationRate,
      transactionsCount: stats.summary.transactionsCount,
      firstTransactionDate: stats.summary.firstTransactionDate,
      lastTransactionDate: stats.summary.lastTransactionDate,
    },
  };
}

// ============================================================================
// Budget Spending Stats Serializer
// ============================================================================

interface SpendingCategoryInternal {
  categoryId: string;
  name: string;
  color: string;
  amount: number; // cents
  children?: SpendingCategoryInternal[];
}

interface SpendingStatsInternal {
  spendingsByCategory: SpendingCategoryInternal[];
  spendingOverTime: {
    granularity: 'monthly' | 'weekly';
    periods: {
      periodStart: string;
      periodEnd: string;
      expense: number; // cents
      income: number; // cents
    }[];
  };
}

function serializeSpendingCategory(item: SpendingCategoryInternal) {
  return {
    categoryId: item.categoryId,
    name: item.name,
    color: item.color,
    amount: centsToApiDecimal(item.amount),
    ...(item.children?.length && {
      children: item.children.map(serializeSpendingCategory),
    }),
  };
}

export function serializeBudgetSpendingStats(stats: SpendingStatsInternal) {
  return {
    spendingsByCategory: stats.spendingsByCategory.map(serializeSpendingCategory),
    spendingOverTime: {
      granularity: stats.spendingOverTime.granularity,
      periods: stats.spendingOverTime.periods.map((period) => ({
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        expense: centsToApiDecimal(period.expense),
        income: centsToApiDecimal(period.income),
      })),
    },
  };
}

// ============================================================================
// Budget Periods Serializer
// ============================================================================

interface BudgetPeriodsInternal {
  recurrence: string;
  periods: {
    index: number;
    periodStart: Date;
    periodEnd: Date;
    expense: number; // cents
    income: number; // cents
    spent: number; // cents
    limitAmount: number | null; // cents
    utilizationRate: number | null;
  }[];
  cumulative: {
    granularity: string;
    current: { step: number; stepStart: Date; value: number; periodValue: number }[];
    previous: { step: number; stepStart: Date; value: number; periodValue: number }[];
  };
}

const serializeCumulativeStep = (step: BudgetPeriodsInternal['cumulative']['current'][number]) => ({
  step: step.step,
  stepStart: step.stepStart.toISOString(),
  value: centsToApiDecimal(step.value),
  periodValue: centsToApiDecimal(step.periodValue),
});

export function serializeBudgetPeriods(data: BudgetPeriodsInternal) {
  return {
    recurrence: data.recurrence,
    periods: data.periods.map((period) => ({
      index: period.index,
      periodStart: period.periodStart.toISOString(),
      periodEnd: period.periodEnd.toISOString(),
      expense: centsToApiDecimal(period.expense),
      income: centsToApiDecimal(period.income),
      spent: centsToApiDecimal(period.spent),
      limitAmount: centsToApiDecimalOrNull(period.limitAmount),
      utilizationRate: period.utilizationRate,
    })),
    cumulative: {
      granularity: data.cumulative.granularity,
      current: data.cumulative.current.map(serializeCumulativeStep),
      previous: data.cumulative.previous.map(serializeCumulativeStep),
    },
  };
}
