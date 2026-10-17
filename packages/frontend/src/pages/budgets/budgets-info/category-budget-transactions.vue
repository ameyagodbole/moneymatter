<script setup lang="ts">
import {
  type CategoryBudgetTransaction,
  excludeTransactionsFromBudget,
  loadCategoryBudgetTransactions,
  removeTransactionsFromBudget,
  restoreExcludedTransactions,
} from '@/api/budgets';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import Button from '@/components/lib/ui/button/Button.vue';
import Card from '@/components/lib/ui/card/Card.vue';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useNotificationCenter } from '@/components/notification-center';
import { useFormatCurrency } from '@/composable';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/vue-query';
import { useIntersectionObserver } from '@vueuse/core';
import { format, parseISO } from 'date-fns';
import { EyeOffIcon, LayersIcon, Loader2Icon, PlusIcon, Undo2Icon, UnlinkIcon } from '@lucide/vue';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import AddTransactionsDialog from './add-transactions-dialog.vue';

const TRANSACTIONS_PAGE_SIZE = 50;

const props = defineProps<{
  budgetId: string;
  /** Recurring budgets: the instant whose period to list; undefined means the current one. */
  at: Date | undefined;
  /** Exclude / restore change what the budget counts, so they need `manage`. */
  canManage: boolean;
  /** Linking and unlinking the caller's own transactions needs `write`. */
  canWrite: boolean;
  transactionsCount: number;
}>();

const { t } = useI18n();
const queryClient = useQueryClient();
const { formatBaseCurrency } = useFormatCurrency();
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();

const budgetIdKey = computed(() => props.budgetId);
const atKey = computed(() => props.at?.toISOString() ?? 'current');

// Distinct query-key prefix (`budgetCategoryTransactions`) — not derived from
// `budgetStats` — so invalidating budget stats elsewhere doesn't bust the list.
const {
  data: transactionsData,
  isLoading,
  isError,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
} = useInfiniteQuery({
  queryFn: ({ pageParam }) =>
    loadCategoryBudgetTransactions({
      budgetId: props.budgetId,
      from: pageParam,
      limit: TRANSACTIONS_PAGE_SIZE,
      at: props.at,
    }),
  queryKey: [...VUE_QUERY_CACHE_KEYS.budgetCategoryTransactions, budgetIdKey, atKey],
  initialPageParam: 0,
  getNextPageParam: (lastPage, pages) => {
    const loaded = pages.reduce((count, page) => count + page.transactions.length, 0);
    return loaded < lastPage.total ? loaded : undefined;
  },
  staleTime: 30_000,
});

const transactions = computed(() => transactionsData.value?.pages.flatMap((page) => page.transactions) ?? []);
const excluded = computed(() => transactionsData.value?.pages[0]?.excluded ?? []);
const isExcludedExpanded = ref(false);

const sentinelRef = ref<HTMLElement | null>(null);
useIntersectionObserver(sentinelRef, ([entry]) => {
  if (entry?.isIntersecting && hasNextPage.value && !isFetchingNextPage.value) fetchNextPage();
});

// Totals per category over the rows loaded so far.
const categoryBreakdown = computed(() => {
  const breakdown = new Map<string, { category: CategoryBudgetTransaction['effectiveCategory']; amount: number }>();

  for (const tx of transactions.value) {
    if (!tx.effectiveCategory) continue;
    const amount = tx.effectiveRefAmount || tx.refAmount;
    const existing = breakdown.get(tx.effectiveCategory.id);
    if (existing) existing.amount += amount;
    else breakdown.set(tx.effectiveCategory.id, { category: tx.effectiveCategory, amount });
  }

  return [...breakdown.values()].sort((a, b) => b.amount - a.amount);
});
const totalBreakdownAmount = computed(() => categoryBreakdown.value.reduce((sum, item) => sum + item.amount, 0));

const refreshBudget = () => {
  queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.budgetCategoryTransactions });
  queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.budgetStats });
  queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.budgetSpendingStats });
  queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.budgetPeriods });
};

const { mutate: excludeTransaction, isPending: isExcluding } = useMutation({
  mutationFn: ({ transactionId }: { transactionId: string }) =>
    excludeTransactionsFromBudget({ budgetId: props.budgetId, transactionIds: [transactionId] }),
  onSuccess: () => {
    refreshBudget();
    addSuccessNotification(t('budgets.overrides.excludeSuccess'));
  },
  onError: () => addErrorNotification(t('budgets.overrides.excludeError')),
});

const { mutate: restoreTransaction, isPending: isRestoring } = useMutation({
  mutationFn: ({ transactionId }: { transactionId: string }) =>
    restoreExcludedTransactions({ budgetId: props.budgetId, transactionIds: [transactionId] }),
  onSuccess: () => {
    refreshBudget();
    addSuccessNotification(t('budgets.overrides.restoreSuccess'));
  },
  onError: () => addErrorNotification(t('budgets.overrides.restoreError')),
});

const { mutate: unlinkTransaction, isPending: isUnlinking } = useMutation({
  mutationFn: ({ transactionId }: { transactionId: string }) =>
    removeTransactionsFromBudget({ budgetId: props.budgetId, payload: { transactionIds: [transactionId] } }),
  onSuccess: () => {
    refreshBudget();
    addSuccessNotification(t('budgets.list.unlinkTransactionsSuccess'));
  },
  onError: () => addErrorNotification(t('budgets.overrides.unlinkError')),
});

const isMutating = computed(() => isExcluding.value || isRestoring.value || isUnlinking.value);

const formatTransactionDate = (date: string) => format(parseISO(date), 'MMM d, yyyy');
</script>

<template>
  <div>
    <!-- Category Breakdown -->
    <Card v-if="categoryBreakdown.length > 0" class="mb-6 p-4">
      <h3 class="mb-4 font-medium">{{ $t('budgets.categoryBudget.categoryBreakdown') }}</h3>
      <div class="space-y-3">
        <div v-for="item in categoryBreakdown" :key="item.category?.id" class="flex items-center gap-3">
          <div class="size-3 shrink-0 rounded-full" :style="{ backgroundColor: item.category?.color || '#888' }" />
          <span class="flex-1 truncate text-sm">{{ item.category?.name }}</span>
          <span class="text-muted-foreground text-sm font-medium tabular-nums">
            {{ formatBaseCurrency(item.amount) }}
          </span>
          <span class="text-muted-foreground w-12 text-right text-xs">
            {{ Math.round((item.amount / totalBreakdownAmount) * 100) }}%
          </span>
        </div>
      </div>
    </Card>

    <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="text-lg font-medium">{{ $t('budgets.categoryBudget.transactionsTitle') }}</h2>
        <p class="text-muted-foreground text-sm">
          {{ $t('budgets.categoryBudget.transactionsCount', { count: transactionsCount }) }}
        </p>
      </div>
      <AddTransactionsDialog v-if="canWrite">
        <Button variant="outline" size="sm">
          <PlusIcon class="size-4" />
          {{ $t('budgets.overrides.addByHand') }}
        </Button>
      </AddTransactionsDialog>
    </div>

    <Card class="overflow-clip">
      <div class="p-3 @md:p-4">
        <div v-if="isLoading" class="flex items-center justify-center py-12">
          <div class="text-muted-foreground text-sm">{{ $t('pages.budgetDetails.loading') }}</div>
        </div>
        <div v-else-if="isError" class="flex items-center justify-center py-12">
          <div class="text-destructive-text text-sm">{{ $t('budgets.categoryBudget.transactionsLoadError') }}</div>
        </div>
        <template v-else-if="transactions.length > 0">
          <div class="space-y-1">
            <div
              v-for="tx in transactions"
              :key="`${tx.id}-${tx.effectiveCategory?.id}`"
              class="group hover:bg-muted/50 flex items-center gap-3 rounded-lg p-2 transition-colors"
            >
              <div
                v-if="tx.effectiveCategory"
                class="size-8 shrink-0 rounded-full"
                :style="{ backgroundColor: tx.effectiveCategory.color }"
              />
              <div v-else class="bg-muted size-8 shrink-0 rounded-full" />

              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span v-if="tx.effectiveCategory" class="truncate text-sm font-medium">
                    {{ tx.effectiveCategory.name }}
                  </span>
                  <span v-else class="text-muted-foreground truncate text-sm">
                    {{ $t('pages.budgetDetails.uncategorized') }}
                  </span>
                  <span
                    v-if="tx.source === 'linked'"
                    class="bg-primary/10 text-primary-text shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium"
                  >
                    {{ $t('budgets.overrides.addedByHand') }}
                  </span>
                </div>
                <div class="text-muted-foreground flex items-center gap-2 text-xs">
                  <span>{{ formatTransactionDate(tx.time) }}</span>
                  <span v-if="tx.note" class="truncate">{{ tx.note }}</span>
                </div>
              </div>

              <span
                class="text-sm font-medium tabular-nums"
                :class="tx.transactionType === 'expense' ? 'text-app-expense-color' : 'text-app-income-color'"
              >
                {{ tx.transactionType === 'expense' ? '-' : '+'
                }}{{ formatBaseCurrency(tx.effectiveRefAmount || tx.refAmount) }}
              </span>

              <DesktopOnlyTooltip v-if="tx.source === 'rule' && canManage" :content="$t('budgets.overrides.exclude')">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  :disabled="isMutating"
                  :aria-label="$t('budgets.overrides.exclude')"
                  @click="excludeTransaction({ transactionId: tx.id })"
                >
                  <EyeOffIcon class="size-4" />
                </Button>
              </DesktopOnlyTooltip>
              <DesktopOnlyTooltip
                v-else-if="tx.source === 'linked' && canWrite"
                :content="$t('budgets.overrides.unlink')"
              >
                <Button
                  variant="ghost"
                  size="icon-sm"
                  :disabled="isMutating"
                  :aria-label="$t('budgets.overrides.unlink')"
                  @click="unlinkTransaction({ transactionId: tx.id })"
                >
                  <UnlinkIcon class="size-4" />
                </Button>
              </DesktopOnlyTooltip>
            </div>
          </div>

          <div v-if="hasNextPage" ref="sentinelRef" class="flex justify-center p-3">
            <Loader2Icon v-if="isFetchingNextPage" class="text-muted-foreground size-4 animate-spin" />
          </div>
        </template>
        <div v-else class="flex flex-col items-center justify-center py-12 text-center">
          <div class="bg-muted mb-4 flex size-16 items-center justify-center rounded-full">
            <LayersIcon class="text-muted-foreground size-8" />
          </div>
          <h3 class="mb-1 font-medium">{{ $t('budgets.categoryBudget.noTransactions') }}</h3>
          <p class="text-muted-foreground max-w-sm text-sm">
            {{ $t('budgets.categoryBudget.noTransactionsDescription') }}
          </p>
        </div>
      </div>
    </Card>

    <!-- Excluded by hand -->
    <Card v-if="excluded.length" class="mt-4 p-3 @md:p-4">
      <Button
        variant="ghost"
        size="sm"
        class="text-muted-foreground h-auto p-0 text-sm"
        @click="isExcludedExpanded = !isExcludedExpanded"
      >
        <EyeOffIcon class="size-4" />
        {{ $t('budgets.overrides.excludedTitle', { count: excluded.length }) }}
      </Button>

      <div v-if="isExcludedExpanded" class="mt-3 space-y-1">
        <div v-for="tx in excluded" :key="tx.id" class="flex items-center gap-3 rounded-lg p-2 opacity-70">
          <div
            class="bg-muted size-6 shrink-0 rounded-full"
            :style="tx.category ? { backgroundColor: tx.category.color } : undefined"
          />
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm">{{ tx.category?.name ?? $t('pages.budgetDetails.uncategorized') }}</div>
            <div class="text-muted-foreground flex items-center gap-2 text-xs">
              <span>{{ formatTransactionDate(tx.time) }}</span>
              <span v-if="tx.note" class="truncate">{{ tx.note }}</span>
            </div>
          </div>
          <span class="text-muted-foreground text-sm tabular-nums line-through">
            {{ formatBaseCurrency(tx.refAmount) }}
          </span>
          <DesktopOnlyTooltip v-if="canManage" :content="$t('budgets.overrides.restore')">
            <Button
              variant="ghost"
              size="icon-sm"
              :disabled="isMutating"
              :aria-label="$t('budgets.overrides.restore')"
              @click="restoreTransaction({ transactionId: tx.id })"
            >
              <Undo2Icon class="size-4" />
            </Button>
          </DesktopOnlyTooltip>
        </div>
      </div>
    </Card>
  </div>
</template>
