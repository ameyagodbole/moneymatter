<script setup lang="ts">
import { addTransactionsToBudget, loadBudgetById } from '@/api/budgets';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import Checkbox from '@/components/lib/ui/checkbox/Checkbox.vue';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { useNotificationCenter } from '@/components/notification-center';
import RecordsFiltersDialog from '@/components/records-filters/filters-dialog.vue';
import RecordsFilters from '@/components/records-filters/index.vue';
import { useTransactionsWithFilters } from '@/components/records-filters/transactions-with-filters';
import TransactionRecord from '@/components/transactions-list/transaction-record.vue';
import { useShiftMultiSelect } from '@/composable/shift-multi-select';
import { useVirtualizedInfiniteScroll } from '@/composable/virtualized-infinite-scroll';
import { useWindowBreakpoints } from '@/composable/window-breakpoints';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { cloneDeep } from 'lodash-es';
import { computed, reactive, ref, watch, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';

import { getSelectAllState } from './select-all-state';

const { t } = useI18n();

const route = useRoute();
const { addErrorNotification } = useNotificationCenter();
const budgetData = ref();
const queryClient = useQueryClient();

const pickedTransactionsIds = reactive<Set<string>>(new Set());
const { handleSelection, resetSelection, isShiftKeyPressed } = useShiftMultiSelect(pickedTransactionsIds);

const isAddingTransactionModalVisible = ref<boolean>(false);
const currentBudgetId = ref<string>(String(route.params.id));
const isTransactionsPicked = computed(() => !!pickedTransactionsIds.size);
const { data: budgetItem, isLoading } = useQuery({
  queryFn: () => loadBudgetById(currentBudgetId.value),
  queryKey: [VUE_QUERY_CACHE_KEYS.budgetsListItem, currentBudgetId.value],
  staleTime: Infinity,
});

const {
  isResetButtonDisabled,
  isFiltersOutOfSync,
  resetFilters,
  applyFilters,
  appliedFilters,
  isAnyFiltersApplied,
  filters,
  transactionsPages,
  fetchNextPage: fetchNextTransactionPage,
  hasNextPage: hasNextTransactionsPage,
  isFetchingNextPage: isFetchingNextTransactionsPage,
  invalidate,
} = useTransactionsWithFilters({
  appendQueryKey: [currentBudgetId],
  queryEnabled: isAddingTransactionModalVisible,
  staticFilters: { excludedBudgetIds: [currentBudgetId.value] },
});

const addTransactions = async () => {
  const data = {
    transactionIds: [...pickedTransactionsIds.values()],
  };
  try {
    await addTransactionsToBudget(currentBudgetId.value, data);
    invalidate();
    queryClient.invalidateQueries({ queryKey: [...VUE_QUERY_CACHE_KEYS.budgetStats, currentBudgetId] });
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.budgetAddingTransactionList });
    queryClient.invalidateQueries({
      predicate: (query) => query.queryKey.includes(currentBudgetId.value),
    });
  } catch (err: unknown) {
    const message = (err as any)?.data?.message ?? 'Failed to add transactions';
    addErrorNotification(message);
  }
  isAddingTransactionModalVisible.value = false;
  resetSelection();
};

watchEffect(() => {
  if (!isLoading.value && budgetItem.value) {
    budgetData.value = cloneDeep(budgetItem.value);
    budgetData.value.startDate = new Date(budgetData.value.startDate);
    budgetData.value.endDate = new Date(budgetData.value.endDate);
  }
});

const scrollAreaRef = ref<InstanceType<typeof ScrollArea> | null>(null);
const parentRef = computed<HTMLElement | null>(() => scrollAreaRef.value?.viewportRef?.viewportElement ?? null);

const flatTransactions = computed(() => transactionsPages.value?.pages?.flat() ?? []);

// "Select all" covers the rows loaded so far, matching the transactions page.
const loadedIds = computed(() => flatTransactions.value.map((tx) => tx.id));
const selectAllState = computed(() =>
  getSelectAllState({ loadedIds: loadedIds.value, selectedIds: pickedTransactionsIds }),
);
const isLoadedOnlyHintVisible = computed(() => selectAllState.value === true && !!hasNextTransactionsPage.value);

const toggleSelectAll = () => {
  if (selectAllState.value === true) {
    loadedIds.value.forEach((id) => pickedTransactionsIds.delete(id));
  } else {
    loadedIds.value.forEach((id) => pickedTransactionsIds.add(id));
  }
};

const { virtualRows, totalSize } = useVirtualizedInfiniteScroll({
  items: flatTransactions,
  hasNextPage: hasNextTransactionsPage,
  fetchNextPage: fetchNextTransactionPage,
  isFetchingNextPage: isFetchingNextTransactionsPage,
  parentRef,
  enabled: isAddingTransactionModalVisible,
  getItemKey: (index) => flatTransactions.value[index]!.id,
});

const isFiltersDialogOpen = ref(false);

watch(appliedFilters, () => {
  isFiltersDialogOpen.value = false;
});

const isMobileView = useWindowBreakpoints(1024);
</script>

<template>
  <ResponsiveDialog
    v-model:open="isAddingTransactionModalVisible"
    dialogContentClass="max-w-[900px] h-[85vh]"
    no-internal-scroll
  >
    <template #trigger>
      <slot />
    </template>

    <template #title>
      <span>{{ t('budgets.addTransactionsDialog.title') }}</span>
    </template>

    <div class="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[max-content_minmax(0,1fr)]">
      <div class="relative min-h-0 overflow-y-auto px-1">
        <template v-if="isMobileView">
          <RecordsFiltersDialog v-model:open="isFiltersDialogOpen" :isAnyFiltersApplied="isAnyFiltersApplied">
            <div class="relative max-h-[calc(100vh-var(--header-height)-32px)] overflow-auto">
              <RecordsFilters
                v-model:filters="filters"
                :is-reset-button-disabled="isResetButtonDisabled"
                :is-filters-out-of-sync="isFiltersOutOfSync"
                @reset-filters="resetFilters"
                @apply-filters="applyFilters"
              />
            </div>
          </RecordsFiltersDialog>
        </template>
        <template v-else>
          <RecordsFilters
            v-model:filters="filters"
            :is-reset-button-disabled="isResetButtonDisabled"
            :is-filters-out-of-sync="isFiltersOutOfSync"
            @reset-filters="resetFilters"
            @apply-filters="applyFilters"
          />
        </template>
      </div>

      <div v-if="transactionsPages" class="relative flex min-h-0 w-full flex-col">
        <div v-if="loadedIds.length" class="flex shrink-0 flex-col gap-1 border-b pr-3 pb-2">
          <div class="flex items-center justify-between gap-2">
            <label class="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox :model-value="selectAllState" @update:model-value="toggleSelectAll" />
              {{ t('budgets.addTransactionsDialog.selectAll') }}
            </label>
            <span v-if="isTransactionsPicked" class="text-muted-foreground text-xs tabular-nums">
              {{ t('budgets.addTransactionsDialog.selectedCount', pickedTransactionsIds.size) }}
            </span>
          </div>
          <p v-if="isLoadedOnlyHintVisible" class="text-muted-foreground text-xs">
            {{ t('budgets.addTransactionsDialog.loadedOnlyHint') }}
          </p>
        </div>

        <ScrollArea ref="scrollAreaRef" class="min-h-0 flex-1" viewport-class="h-full">
          <div :style="{ height: `${totalSize}px`, position: 'relative' }">
            <div
              v-for="virtualRow in virtualRows"
              :key="String(virtualRow.key)"
              :style="{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }"
            >
              <label
                v-if="flatTransactions[virtualRow.index]"
                :class="[
                  'grid grid-cols-[min-content_minmax(0,1fr)] items-center gap-2 pr-3',
                  { 'select-none': isShiftKeyPressed },
                ]"
              >
                <Checkbox
                  :model-value="pickedTransactionsIds.has(flatTransactions[virtualRow.index]!.id)"
                  @update:model-value="
                    handleSelection(
                      !!$event,
                      flatTransactions[virtualRow.index]!.id,
                      virtualRow.index,
                      flatTransactions,
                      (v) => v.id,
                    )
                  "
                />
                <TransactionRecord :tx="flatTransactions[virtualRow.index]!" />
              </label>
              <div v-else class="flex h-13 items-center justify-center">{{ t('transactions.list.loadingMore') }}</div>
            </div>
          </div>
          <template v-if="!hasNextTransactionsPage">
            <p class="flex justify-center">{{ t('transactions.list.noMoreData') }}</p>
          </template>
        </ScrollArea>

        <div v-if="isTransactionsPicked" class="flex shrink-0 gap-2 border-t pt-3">
          <Button type="button" variant="outline" class="w-full" @click="resetSelection">
            {{ t('budgets.addTransactionsDialog.clearSelection') }}
          </Button>
          <Button type="button" class="w-full" @click="addTransactions">
            {{ t('budgets.addTransactionsDialog.addSelected') }}
          </Button>
        </div>
      </div>
    </div>
  </ResponsiveDialog>
</template>
