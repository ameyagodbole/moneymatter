<script setup lang="ts">
import { type BudgetPeriodsResponse, loadBudgetPeriods, loadBudgetSpendingStats } from '@/api/budgets';
import { QUERY_CACHE_STALE_TIME, VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { useDateLocale } from '@/composable/use-date-locale';
import CategoryBreakdown from '@/pages/analytics/subpages/annual-overview/components/category-breakdown.vue';
import CumulativeChart from '@/pages/analytics/subpages/annual-overview/components/cumulative-chart.vue';
import ChartSkeleton from '@/pages/analytics/subpages/cash-flow/components/chart-skeleton.vue';
import SummaryCardSkeleton from '@/pages/analytics/subpages/cash-flow/components/summary-card-skeleton.vue';
import SummaryCard from '@/pages/analytics/subpages/cash-flow/components/summary-card.vue';
import { BUDGET_RECURRENCES } from '@bt/shared/types';
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import LimitHistoryCard from './limit-history-card.vue';
import { getLimitLeft } from '../../budget-limit-left';
import { computeLimitHistory } from './limit-history';
import BudgetPaceCard from './budget-pace-card.vue';
import { computeBudgetPace } from './budget-pace';
import BudgetPeriodChart from './budget-period-chart.vue';
import {
  getAdjacentPeriodAt,
  getPercentChange,
  toCategoryBreakdownData,
  toCumulativeChartData,
} from './budget-period-utils';

/** Periods shown in the history chart. */
const HISTORY_PERIOD_COUNT = 12;

const props = defineProps<{
  budgetId: string;
  /** Instant whose period is selected; undefined means the current period. */
  at: Date | undefined;
}>();

const emit = defineEmits<{
  'update:at': [value: Date];
}>();

const { t } = useI18n();
const { format } = useDateLocale();

const budgetIdKey = computed(() => props.budgetId);
const atKey = computed(() => props.at?.toISOString() ?? 'current');

const {
  data: periodsData,
  isLoading: isLoadingPeriods,
  isError: isPeriodsError,
} = useQuery({
  queryKey: [...VUE_QUERY_CACHE_KEYS.budgetPeriods, budgetIdKey, atKey],
  queryFn: () => loadBudgetPeriods({ budgetId: props.budgetId, at: props.at, count: HISTORY_PERIOD_COUNT }),
  staleTime: QUERY_CACHE_STALE_TIME.ANALYTICS,
  placeholderData: (previous) => previous,
});

const periods = computed(() => periodsData.value?.periods ?? []);
const selected = computed(() => periods.value[periods.value.length - 1] ?? null);
const previous = computed(() => (periods.value.length > 1 ? periods.value[periods.value.length - 2]! : null));
const recurrence = computed<BudgetPeriodsResponse['recurrence']>(
  () => periodsData.value?.recurrence ?? BUDGET_RECURRENCES.monthly,
);

// An instant inside the previous period, to load its category breakdown.
const previousAt = computed(() =>
  selected.value && selected.value.index > 0
    ? getAdjacentPeriodAt({
        period: { start: selected.value.periodStart, end: selected.value.periodEnd },
        direction: 'previous',
      })
    : null,
);

const previousAtKey = computed(() => previousAt.value?.toISOString() ?? 'none');

const { data: currentSpending, isLoading: isLoadingCurrentSpending } = useQuery({
  queryKey: [...VUE_QUERY_CACHE_KEYS.budgetSpendingStats, budgetIdKey, atKey],
  queryFn: () => loadBudgetSpendingStats({ budgetId: props.budgetId, at: props.at }),
  staleTime: QUERY_CACHE_STALE_TIME.ANALYTICS,
});

const { data: previousSpending, isLoading: isLoadingPreviousSpending } = useQuery({
  queryKey: [...VUE_QUERY_CACHE_KEYS.budgetSpendingStats, budgetIdKey, previousAtKey],
  queryFn: () => loadBudgetSpendingStats({ budgetId: props.budgetId, at: previousAt.value! }),
  enabled: computed(() => previousAt.value !== null),
  staleTime: QUERY_CACHE_STALE_TIME.ANALYTICS,
});

const limitLeft = computed(() =>
  selected.value ? getLimitLeft({ limit: selected.value.limitAmount, netSpend: selected.value.spent }) : null,
);

const spentChange = computed(() =>
  selected.value && previous.value
    ? getPercentChange({ current: selected.value.spent, previous: previous.value.spent })
    : undefined,
);

const cumulativeCurrent = computed(() =>
  periodsData.value && selected.value
    ? toCumulativeChartData({
        steps: periodsData.value.cumulative.current,
        granularity: periodsData.value.cumulative.granularity,
        labelStart: selected.value.periodStart,
        format,
      })
    : [],
);
const cumulativePrevious = computed(() =>
  periodsData.value && selected.value
    ? toCumulativeChartData({
        steps: periodsData.value.cumulative.previous,
        granularity: periodsData.value.cumulative.granularity,
        labelStart: selected.value.periodStart,
        format,
      })
    : [],
);

const currentCategories = computed(() =>
  toCategoryBreakdownData({ spendingsByCategory: currentSpending.value?.spendingsByCategory }),
);
const previousCategories = computed(() =>
  toCategoryBreakdownData({ spendingsByCategory: previousSpending.value?.spendingsByCategory }),
);

// Pace only means something for the period running now.
const pace = computed(() =>
  selected.value
    ? computeBudgetPace({
        periodStart: selected.value.periodStart,
        periodEnd: selected.value.periodEnd,
        spent: selected.value.spent,
        limit: selected.value.limitAmount,
      })
    : null,
);

// How finished periods compared with their limits.
const limitHistory = computed(() => computeLimitHistory({ periods: periods.value }));
const hasAnyLimit = computed(() => periods.value.some((period) => period.limitAmount !== null));

const selectPeriod = ({ periodStart }: { periodStart: string }) => emit('update:at', new Date(periodStart));
</script>

<template>
  <div class="@container/recurring space-y-6">
    <div v-if="isPeriodsError" class="flex h-40 items-center justify-center">
      <div class="text-destructive-text">{{ t('budgets.recurring.loadError') }}</div>
    </div>

    <template v-else>
      <!-- Summary Cards -->
      <div class="grid grid-cols-2 gap-4 @2xl/recurring:grid-cols-4">
        <template v-if="isLoadingPeriods">
          <SummaryCardSkeleton v-for="n in 4" :key="n" title-width="w-24" value-width="w-28" />
        </template>
        <template v-else-if="selected">
          <SummaryCard
            :title="t('budgets.recurring.spentThisPeriod')"
            :value="selected.spent"
            :change="spentChange"
            :comparison-period-label="t('budgets.recurring.vsPreviousPeriod')"
            invert-colors
          />
          <SummaryCard
            :title="t('budgets.recurring.previousPeriod')"
            :value="previous?.spent ?? 0"
            :value-label="previous ? undefined : '—'"
          />
          <SummaryCard
            :title="t('budgets.recurring.limitUsed')"
            :value="0"
            :value-label="selected.utilizationRate === null ? '—' : `${Math.round(selected.utilizationRate)}%`"
          />
          <SummaryCard
            :title="
              limitLeft !== null && limitLeft < 0
                ? t('budgets.recurring.overLimitBy')
                : t('budgets.recurring.limitLeft')
            "
            :value="Math.abs(limitLeft ?? 0)"
            :value-label="limitLeft === null ? '—' : undefined"
          />
        </template>
      </div>

      <BudgetPaceCard v-if="pace && selected?.limitAmount" :pace="pace" :limit="selected.limitAmount" />

      <LimitHistoryCard v-if="!isLoadingPeriods && hasAnyLimit" :history="limitHistory" />

      <!-- Spending per period against the limit -->
      <ChartSkeleton v-if="isLoadingPeriods" />
      <BudgetPeriodChart
        v-else
        :periods="periods"
        :recurrence="recurrence"
        :selected-index="selected?.index ?? null"
        @select="selectPeriod"
      />

      <!-- Running total: this period vs the previous one -->
      <ChartSkeleton v-if="isLoadingPeriods" />
      <div v-else-if="cumulativeCurrent.length" class="border-border bg-card rounded-lg border p-4 max-sm:px-0">
        <CumulativeChart
          :current-period-data="cumulativeCurrent"
          :previous-period-data="cumulativePrevious"
          metric="expenses"
        />
      </div>
    </template>

    <!-- Category spending: this period vs the previous one -->
    <CategoryBreakdown
      :current-period-data="currentCategories"
      :previous-period-data="previousCategories"
      :is-loading="isLoadingCurrentSpending || (previousAt !== null && isLoadingPreviousSpending)"
    />
  </div>
</template>
