<script setup lang="ts">
import { deleteBudget as deleteBudgetApi, loadBudgetStats } from '@/api';
import { archiveBudget as archiveBudgetApi, loadSystemBudgets } from '@/api/budgets';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { useNotificationCenter } from '@/components/notification-center';
import { ROUTES_NAMES } from '@/routes';
import { BUDGET_RECURRENCES, BUDGET_STATUSES, BudgetModel } from '@bt/shared/types';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/vue-query';
import { ArchiveRestoreIcon, WalletIcon } from '@lucide/vue';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import BudgetCardSkeleton from './budget-card-skeleton.vue';
import BudgetCard from './budget-list-cards/budget-card.vue';
import { formatBudgetTimeStatus, getBudgetTimeStatus } from './budget-time-status';

const { t } = useI18n();
const { addErrorNotification, addSuccessNotification } = useNotificationCenter();
const router = useRouter();
const queryClient = useQueryClient();

const showArchived = ref(false);

const statusFilter = computed(() => (showArchived.value ? 'active,archived' : 'active'));

const {
  data: budgetsList,
  isPlaceholderData: isBudgetsListPlaceholder,
  isFetching: isBudgetsListFetching,
} = useQuery({
  queryFn: () => loadSystemBudgets({ status: statusFilter.value }),
  queryKey: [...VUE_QUERY_CACHE_KEYS.budgetsList, statusFilter],
  staleTime: Infinity,
  placeholderData: (previousData) => previousData ?? [],
});

// True only on very first load when we have no data at all
const isInitialLoading = computed(() => isBudgetsListPlaceholder.value && !budgetsList.value?.length);
// True when we have existing data but are fetching updated results (e.g. toggling archived)
const isLoadingMore = computed(() => isBudgetsListFetching.value && !isInitialLoading.value);

const budgetStatsQueries = useQueries({
  queries: computed(() =>
    (budgetsList.value || []).map((budget: BudgetModel) => ({
      queryKey: [...VUE_QUERY_CACHE_KEYS.budgetStats, budget.id],
      queryFn: () => loadBudgetStats({ budgetId: budget.id }),
      staleTime: Infinity,
    })),
  ),
});

const getBudgetStats = (budgetId: string) => {
  const index = budgetsList.value?.findIndex((b: BudgetModel) => b.id === budgetId) ?? -1;
  if (index === -1) return null;
  return budgetStatsQueries.value[index]?.data ?? null;
};

const isBudgetStatsLoading = (budgetId: string) => {
  const index = budgetsList.value?.findIndex((b: BudgetModel) => b.id === budgetId) ?? -1;
  if (index === -1) return true;
  const query = budgetStatsQueries.value[index];
  if (!query) return true;
  if (query.isPending) return true;
  if (query.isFetching && !query.data) return true;
  if (query.data === undefined || query.data === null) return true;
  return false;
};

const navigateToBudget = ({ budgetId }: { budgetId: string }) => {
  router.push({ name: ROUTES_NAMES.plannedBudgetDetails, params: { id: budgetId } });
};

const deleteBudget = async ({ budgetId }: { budgetId: string }) => {
  try {
    await deleteBudgetApi(budgetId);
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.budgetsList });
    addSuccessNotification(t('budgets.list.deleteSuccess'));
  } catch {
    addErrorNotification(t('budgets.list.deleteError'));
  }
};

const { mutate: archiveBudget } = useMutation({
  mutationFn: archiveBudgetApi,
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.budgetsList });
  },
  onError: () => {
    addErrorNotification(t('budgets.list.archiveError'));
  },
});

const handleArchive = ({ budgetId, isArchived }: { budgetId: string; isArchived: boolean }) => {
  archiveBudget({ budgetId, isArchived });
};

const getTimeStatus = (budget: BudgetModel) => {
  const status = getBudgetTimeStatus({ budget, period: getBudgetStats(budget.id)?.period });
  return status ? { status: status.status, text: formatBudgetTimeStatus({ status, t }) } : null;
};

const isArchived = (budget: BudgetModel) => budget.status === BUDGET_STATUSES.archived;

// Sort priority: active/upcoming (0) > no dates (1) > ended (2) > archived (3)
const getBudgetSortPriority = (budget: BudgetModel): number => {
  if (isArchived(budget)) return 3;
  const status = getTimeStatus(budget);
  // A recurring budget is current until its series ends, even before its stats arrive.
  if (!status) return budget.recurrence === BUDGET_RECURRENCES.none ? 1 : 0; // No dates set
  if (status.status === 'ended') return 2;
  return 0; // active or upcoming
};

const sortBudgetsByStatus = (budgets: BudgetModel[]): BudgetModel[] => {
  return [...budgets].sort((a, b) => getBudgetSortPriority(a) - getBudgetSortPriority(b));
};

const sortedBudgets = computed(() => sortBudgetsByStatus(budgetsList.value || []));
</script>

<template>
  <div>
    <!-- Initial full-page skeleton (no data yet) -->
    <BudgetCardSkeleton v-if="isInitialLoading" />

    <template v-else>
      <div class="mb-4 flex items-center justify-end">
        <button
          type="button"
          class="text-muted-foreground hover:text-foreground flex shrink-0 items-center gap-1.5 text-xs transition-colors"
          @click="showArchived = !showArchived"
        >
          <ArchiveRestoreIcon class="size-3.5" />
          {{ showArchived ? $t('budgets.list.hideArchived') : $t('budgets.list.showArchived') }}
        </button>
      </div>

      <div
        v-if="sortedBudgets.length === 0 && !isLoadingMore"
        class="flex flex-col items-center justify-center py-12 text-center"
      >
        <div class="bg-muted mb-4 flex size-16 items-center justify-center rounded-full">
          <WalletIcon class="text-muted-foreground size-8" />
        </div>
        <h3 class="mb-1 font-medium">{{ $t('budgets.list.emptyState.title') }}</h3>
        <p class="text-muted-foreground max-w-sm text-sm">
          {{ $t('budgets.list.emptyState.description') }}
        </p>
      </div>
      <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
        <BudgetCard
          v-for="budget in sortedBudgets"
          :key="budget.id"
          :budget="budget"
          :is-archived="isArchived(budget)"
          :stats="getBudgetStats(budget.id)"
          :is-stats-loading="isBudgetStatsLoading(budget.id)"
          :time-status="getTimeStatus(budget)"
          @click="navigateToBudget({ budgetId: budget.id })"
          @edit="navigateToBudget({ budgetId: budget.id })"
          @delete="deleteBudget({ budgetId: budget.id })"
          @archive="handleArchive({ budgetId: budget.id, isArchived: !isArchived(budget) })"
        />
        <BudgetCardSkeleton v-if="isLoadingMore" :count="2" inline />
      </div>
    </template>
  </div>
</template>
