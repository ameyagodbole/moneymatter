<script setup lang="ts">
import { deleteBudget as deleteBudgetApi } from '@/api';
import { editBudget, loadBudgetById, loadBudgetStats } from '@/api/budgets';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { AlertDialog } from '@/components/common';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import ActionButton from '@/components/lib/ui/action-button/action-button.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import Card from '@/components/lib/ui/card/Card.vue';
import PillTabs from '@/components/lib/ui/pill-tabs/pill-tabs.vue';
import { useNotificationCenter } from '@/components/notification-center';
import { useBudgetAccess } from '@/composable/use-budget-access';
import { ApiErrorResponseError } from '@/js/errors';
import { captureException } from '@/lib/sentry';
import BudgetSharingPanel from '@/pages/budgets/components/budget-sharing-panel.vue';
import { ROUTES_NAMES } from '@/routes/constants';
import { BUDGET_RECURRENCES, BUDGET_TYPES } from '@bt/shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { cloneDeep } from 'lodash-es';
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowRightIcon,
  CalendarIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  LayersIcon,
  PencilIcon,
  TagIcon,
  Trash2Icon,
  UsersIcon,
  WalletIcon,
} from '@lucide/vue';
import { computed, ref, toRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import type { BudgetEditPayload } from './build-budget-edit-payload';
import BudgetDetailSkeleton from './budget-detail-skeleton.vue';
import BudgetEditForm from './budget-edit-form.vue';
import CategoryBudgetTransactions from './category-budget-transactions.vue';
import BudgetStatsCards from './shared/budget-stats-cards.vue';
import BudgetUtilizationBar from './shared/budget-utilization-bar.vue';
import { useArchiveToggle } from './shared/use-archive-toggle';
import { useBudgetDetails } from './shared/use-budget-details';
import BudgetPeriodStepper from './recurring/budget-period-stepper.vue';
import RecurringBudgetOverview from './recurring/recurring-budget-overview.vue';
import BudgetStatistics from './statistics/budget-statistics.vue';
import TransactionsList from './transactions-list.vue';

const route = useRoute();
const router = useRouter();
const queryClient = useQueryClient();
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();
const { t } = useI18n();
const budgetData = ref();
const currentBudgetId = ref<string>(route.params.id as string);
const isEditDialogOpen = ref(false);
const isCategoriesExpanded = ref(false);

const { data: budgetItem } = useQuery({
  queryFn: () => loadBudgetById(currentBudgetId.value),
  queryKey: [VUE_QUERY_CACHE_KEYS.budgetsListItem, currentBudgetId.value],
  staleTime: Infinity,
});

// Recurring budgets show one period at a time; undefined follows the current period.
const selectedAt = ref<Date | undefined>();
const atKey = computed(() => selectedAt.value?.toISOString() ?? 'current');
const isRecurring = computed(() => !!budgetItem.value && budgetItem.value.recurrence !== BUDGET_RECURRENCES.none);
const recurrence = computed(() => budgetItem.value?.recurrence as Exclude<BUDGET_RECURRENCES, BUDGET_RECURRENCES.none>);

const { data: budgetStats } = useQuery({
  queryFn: () => loadBudgetStats({ budgetId: currentBudgetId.value, at: selectedAt.value }),
  queryKey: [...VUE_QUERY_CACHE_KEYS.budgetStats, currentBudgetId, atKey],
  staleTime: 30_000,
  placeholderData: (previous) => previous,
});

const { stats, transactionDateRange, getBudgetTimeStatus, utilizationColor, utilizationTextColor } = useBudgetDetails({
  budgetStats,
  budgetData,
});

const { isOwner, canManage, canWrite, isSharedWithCaller, ownerHandle } = useBudgetAccess(
  toRef(() => budgetItem.value),
);

// Category budgets track by category and take hand overrides; manual budgets count only what's linked.
const isCategoryBudget = computed(() => budgetItem.value?.type === BUDGET_TYPES.category);

const { mutateAsync, isPending: isBudgetDataUpdating } = useMutation({
  mutationFn: editBudget,
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.budgetsList });
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.budgetStats });
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.budgetPeriods });
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.budgetSpendingStats });
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.budgetCategoryTransactions });
    queryClient.invalidateQueries({ queryKey: [VUE_QUERY_CACHE_KEYS.budgetsListItem, currentBudgetId.value] });
  },
});

const handleSaveFromDialog = async (payload: BudgetEditPayload) => {
  try {
    await mutateAsync({
      budgetId: currentBudgetId.value,
      payload,
    });
    addSuccessNotification(t('budgets.list.updateSuccess'));
    isEditDialogOpen.value = false;
  } catch (err) {
    // API validation errors are expected user-input failures — surface them via a
    // toast but keep them out of Sentry so they don't create alert noise. Anything
    // else is unexpected and worth reporting.
    if (!(err instanceof ApiErrorResponseError)) {
      captureException({ error: err, context: { source: 'budgetEdit', budgetId: currentBudgetId.value } });
    }
    addErrorNotification(t('budgets.list.updateError'));
  }
};

const handleDeleteBudget = async () => {
  try {
    await deleteBudgetApi(currentBudgetId.value);
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.budgetsList });
    // Shared recipients see this budget in their shared-with-me list; clear that cache
    // too so it doesn't linger after the owner deletes the row.
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.sharedWithMe });
    addSuccessNotification(t('budgets.list.deleteSuccess'));
    router.push({ name: ROUTES_NAMES.plannedBudgets });
  } catch (err) {
    captureException({ error: err, context: { source: 'budgetDelete', budgetId: currentBudgetId.value } });
    addErrorNotification(t('budgets.list.deleteError'));
  }
};

const { isBudgetArchived, handleToggleArchive } = useArchiveToggle({ budgetData, budgetId: currentBudgetId });

const activeTab = ref('statistics');
const tabItems = computed(() => {
  const items = [
    { value: 'statistics', label: t('pages.budgetDetails.tabs.statistics') },
    { value: 'transactions', label: t('pages.budgetDetails.tabs.transactions') },
  ];
  if (canManage.value) {
    items.push({ value: 'sharing', label: t('pages.budgetDetails.tabs.sharing') });
  }
  return items;
});

watch(
  budgetItem,
  (item) => {
    if (item) {
      budgetData.value = cloneDeep(item);
      budgetData.value.categoryIds = item.categories?.map((c: { id: string }) => c.id) ?? [];
    }
  },
  { immediate: true },
);
</script>

<template>
  <div v-if="budgetData" class="@container max-w-5xl">
    <div class="mb-6">
      <!-- Hero Header -->
      <div class="flex flex-col gap-4 @md:flex-row @md:items-center @md:justify-between">
        <div class="flex items-center gap-4">
          <div
            v-if="isCategoryBudget"
            class="bg-primary/10 flex size-12 shrink-0 items-center justify-center rounded-xl"
          >
            <LayersIcon class="text-primary-text size-6" />
          </div>
          <div v-else class="bg-muted flex size-12 shrink-0 items-center justify-center rounded-xl">
            <WalletIcon class="text-muted-foreground size-6" />
          </div>
          <div>
            <div class="flex items-center gap-3">
              <h1 class="text-2xl font-semibold tracking-tight">{{ budgetData.name }}</h1>
              <span
                v-if="isSharedWithCaller"
                class="bg-primary/10 text-primary-text inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium"
              >
                <UsersIcon class="size-3" />
                {{ $t('budgets.share.sharedByBadge', { handle: `@${ownerHandle}` }) }}
              </span>
              <span
                v-if="isCategoryBudget"
                class="bg-primary/10 text-primary-text rounded-full px-2.5 py-1 text-xs font-medium"
              >
                {{ $t('budgets.list.autoTracked') }}
              </span>
              <span
                v-if="isBudgetArchived"
                class="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium"
              >
                <ArchiveIcon class="size-3" />
                {{ $t('budgets.list.archivedLabel') }}
              </span>
              <span
                v-if="getBudgetTimeStatus"
                :class="[
                  'rounded-full px-2.5 py-1 text-xs font-medium',
                  getBudgetTimeStatus?.status === 'ended'
                    ? 'bg-muted text-muted-foreground'
                    : getBudgetTimeStatus?.status === 'upcoming'
                      ? 'bg-blue-500/10 text-blue-400'
                      : 'bg-success-text/10 text-success-text',
                ]"
              >
                {{ getBudgetTimeStatus?.text }}
              </span>
            </div>
            <div v-if="transactionDateRange" class="text-muted-foreground mt-1 flex items-center gap-1.5 text-sm">
              <CalendarIcon class="size-3.5" />
              <span v-if="transactionDateRange.first && transactionDateRange.last">
                {{ transactionDateRange.first }}
                <ArrowRightIcon class="inline size-3" />
                {{ transactionDateRange.last }}
              </span>
              <span v-else-if="transactionDateRange.first">{{ transactionDateRange.first }}</span>
              <span v-else-if="transactionDateRange.last">{{ transactionDateRange.last }}</span>
            </div>
            <p v-else class="text-muted-foreground mt-1 text-sm">
              {{
                isCategoryBudget
                  ? $t('budgets.categoryBudget.noTransactions')
                  : $t('pages.budgetDetails.noTransactionsYet')
              }}
            </p>
          </div>
        </div>

        <!-- Action Buttons — owners / `manage` recipients only. Recipients on read/write
             see the "shared by @owner" header badge and no controls. -->
        <div v-if="canManage" class="flex items-center gap-2">
          <ActionButton
            :action="handleToggleArchive"
            :label="isBudgetArchived ? t('budgets.list.unarchive') : t('budgets.list.archive')"
            :icon="isBudgetArchived ? ArchiveRestoreIcon : ArchiveIcon"
            size="sm"
            @error="addErrorNotification(t('budgets.list.archiveError'))"
          />

          <ResponsiveDialog v-model:open="isEditDialogOpen">
            <template #trigger>
              <Button variant="outline" size="sm">
                <PencilIcon class="mr-2 size-4" />
                {{ isCategoryBudget ? $t('budgets.categoryBudget.edit') : $t('budgets.manualBudget.edit') }}
              </Button>
            </template>
            <template #title>
              {{ isCategoryBudget ? $t('budgets.categoryBudget.editTitle') : $t('budgets.manualBudget.editTitle') }}
            </template>
            <BudgetEditForm
              v-if="isEditDialogOpen"
              :budget="budgetData"
              :is-loading="isBudgetDataUpdating"
              @save="handleSaveFromDialog"
            />
          </ResponsiveDialog>

          <AlertDialog
            v-if="isOwner"
            :title="$t('budgets.list.deleteDialog.title')"
            accept-variant="destructive"
            @accept="handleDeleteBudget"
          >
            <template #description>
              {{ $t('budgets.list.deleteDialog.description') }}
            </template>
            <template #trigger>
              <Button variant="destructive" size="sm">
                <Trash2Icon class="size-4" />
              </Button>
            </template>
          </AlertDialog>
        </div>
      </div>
    </div>

    <!-- Tracked Categories Card -->
    <Card v-if="isCategoryBudget" class="mb-6 p-4">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <TagIcon class="text-muted-foreground size-4" />
          <span class="text-sm font-medium">{{ $t('budgets.categoryBudget.trackedCategories') }}</span>
        </div>
        <span class="text-muted-foreground text-sm">
          {{ $t('budgets.categoryBudget.categoriesCount', { count: budgetData.categories?.length || 0 }) }}
        </span>
      </div>
      <div
        class="relative mt-3"
        :class="{ 'max-h-16 overflow-hidden': !isCategoriesExpanded && budgetData.categories?.length > 6 }"
      >
        <div class="flex flex-wrap gap-2">
          <span
            v-for="category in budgetData.categories"
            :key="category.id"
            class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-white"
            :style="{ backgroundColor: category.color }"
          >
            {{ category.name }}
          </span>
        </div>
        <!-- Gradient overlay when collapsed -->
        <div
          v-if="!isCategoriesExpanded && budgetData.categories?.length > 6"
          class="from-card pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-linear-to-t to-transparent"
        />
      </div>
      <Button
        v-if="budgetData.categories?.length > 6"
        variant="ghost"
        size="sm"
        class="text-muted-foreground hover:text-foreground mt-2 h-auto p-0 text-xs"
        @click="isCategoriesExpanded = !isCategoriesExpanded"
      >
        <template v-if="isCategoriesExpanded">
          <ChevronUpIcon class="size-3" />
          {{ $t('budgets.categoryBudget.showLess') }}
        </template>
        <template v-else>
          <ChevronDownIcon class="size-3" />
          {{ $t('budgets.categoryBudget.showMore') }}
        </template>
      </Button>
      <p class="text-muted-foreground mt-3 text-xs">
        {{ $t('budgets.categoryBudget.autoTrackedInfo') }}
      </p>
    </Card>

    <BudgetPeriodStepper
      v-if="isRecurring"
      :period="budgetStats?.period ?? null"
      :recurrence="recurrence"
      :series-end="budgetItem?.endDate"
      :is-pinned="selectedAt !== undefined"
      @update:at="selectedAt = $event"
    />

    <BudgetStatsCards :stats="stats" />

    <BudgetUtilizationBar
      v-if="budgetData.limitAmount"
      :limit-amount="budgetData.limitAmount"
      :stats="stats"
      :utilization-color="utilizationColor"
      :utilization-text-color="utilizationTextColor"
    />

    <PillTabs v-model="activeTab" :items="tabItems" class="mb-6" />

    <!-- Statistics Tab -->
    <template v-if="activeTab === 'statistics'">
      <RecurringBudgetOverview
        v-if="isRecurring"
        :budget-id="currentBudgetId"
        :at="selectedAt"
        @update:at="selectedAt = $event"
      />
      <BudgetStatistics v-else :budget-id="currentBudgetId" />
    </template>

    <!-- Transactions Tab -->
    <template v-else-if="activeTab === 'transactions'">
      <CategoryBudgetTransactions
        v-if="isCategoryBudget"
        :budget-id="currentBudgetId"
        :at="selectedAt"
        :can-manage="canManage"
        :can-write="canWrite"
        :transactions-count="stats.transactionsCount"
      />
      <template v-else>
        <div class="mb-4">
          <h2 class="text-lg font-medium">{{ $t('pages.budgetDetails.transactions') }}</h2>
          <p class="text-muted-foreground text-sm">
            {{ $t('pages.budgetDetails.transactionsLinked', stats.transactionsCount) }}
          </p>
        </div>
        <TransactionsList :budget-id="currentBudgetId" :is-budget-data-updating="isBudgetDataUpdating" />
      </template>
    </template>

    <!-- Sharing Tab — owners + manage recipients only. -->
    <BudgetSharingPanel v-else-if="activeTab === 'sharing' && canManage && budgetItem" :budget="budgetItem" />
  </div>

  <!-- Loading State -->
  <BudgetDetailSkeleton v-else />
</template>
