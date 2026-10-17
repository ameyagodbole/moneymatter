import type { StatsResponse } from '@/api/budgets';
import { BUDGET_RECURRENCES } from '@bt/shared/types';
import { format } from 'date-fns';
import { type Ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { formatBudgetTimeStatus, getBudgetTimeStatus as getTimeStatus } from '../../budget-time-status';

interface BudgetData {
  recurrence?: BUDGET_RECURRENCES;
  startDate?: string | Date | null;
  endDate?: string | Date | null;
  limitAmount?: number | null;
}

export function useBudgetDetails({
  budgetStats,
  budgetData,
}: {
  budgetStats: Ref<StatsResponse | undefined>;
  budgetData: Ref<BudgetData | undefined>;
}) {
  const { t } = useI18n();

  const stats = computed(() => ({
    expenses: budgetStats.value?.summary.actualExpense || 0,
    income: budgetStats.value?.summary.actualIncome || 0,
    balance: budgetStats.value?.summary.balance || 0,
    utilizationRate: budgetStats.value?.summary.utilizationRate ?? null,
    transactionsCount: budgetStats.value?.summary.transactionsCount || 0,
    firstTransactionDate: budgetStats.value?.summary.firstTransactionDate || null,
    lastTransactionDate: budgetStats.value?.summary.lastTransactionDate || null,
  }));

  const formatDate = (date: Date | string | null | undefined) => {
    if (!date) return null;
    const parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime()) || parsedDate.getFullYear() < 2000) return null;
    return format(parsedDate, 'MMM d, yyyy');
  };

  const transactionDateRange = computed(() => {
    const first = stats.value.firstTransactionDate;
    const last = stats.value.lastTransactionDate;
    if (!first && !last) return null;
    return {
      first: first ? formatDate(first) : null,
      last: last ? formatDate(last) : null,
    };
  });

  // Recurring budgets measure against the period on screen, one-off budgets against their own range.
  const getBudgetTimeStatus = computed(() => {
    if (!budgetData.value) return null;
    const status = getTimeStatus({
      budget: { ...budgetData.value, recurrence: budgetData.value.recurrence ?? BUDGET_RECURRENCES.none },
      period: budgetStats.value?.period,
    });
    return status ? { status: status.status, text: formatBudgetTimeStatus({ status, t }) } : null;
  });

  const utilizationColor = computed(() => {
    const rate = stats.value.utilizationRate;
    if (rate === null) return 'bg-muted-foreground';
    if (rate > 90) return 'bg-app-expense-color';
    if (rate > 70) return 'bg-warning-text';
    return 'bg-success-text';
  });

  const utilizationTextColor = computed(() => {
    const rate = stats.value.utilizationRate;
    if (rate === null) return 'text-muted-foreground';
    if (rate > 90) return 'text-app-expense-color';
    if (rate > 70) return 'text-warning-text';
    return 'text-success-text';
  });

  return {
    stats,
    formatDate,
    transactionDateRange,
    getBudgetTimeStatus,
    utilizationColor,
    utilizationTextColor,
  };
}
