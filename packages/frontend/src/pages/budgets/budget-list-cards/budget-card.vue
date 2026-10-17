<script setup lang="ts">
import type { StatsResponse } from '@/api/budgets';
import CategoryCircle from '@/components/common/category-circle.vue';
import { Card } from '@/components/lib/ui/card';
import { useFormatCurrency } from '@/composable';
import { cn } from '@/lib/utils';
import { BUDGET_RECURRENCES, BUDGET_TYPES, BudgetModel, CategoryModel } from '@bt/shared/types';
import { format } from 'date-fns';
import { ArchiveIcon, ArrowRightIcon, CalendarIcon, RepeatIcon, TagsIcon, WalletIcon } from '@lucide/vue';
import { computed } from 'vue';

import BudgetStatsSkeleton from '../budget-stats-skeleton.vue';
import BudgetCardDropdown from './shared/budget-card-dropdown.vue';
import BudgetCardStats from './shared/budget-card-stats.vue';
import BudgetCardUtilization from './shared/budget-card-utilization.vue';

const MAX_VISIBLE_CATEGORIES = 4;

const props = defineProps<{
  budget: BudgetModel;
  isArchived?: boolean;
  stats: StatsResponse | null;
  isStatsLoading: boolean;
  timeStatus: { status: 'ended' | 'upcoming' | 'active'; text: string } | null;
}>();

const emit = defineEmits<{
  edit: [];
  delete: [];
  archive: [];
}>();

const { formatBaseCurrency } = useFormatCurrency();

const isCategoryBudget = computed(() => props.budget.type === BUDGET_TYPES.category);
const isRecurring = computed(() => props.budget.recurrence !== BUDGET_RECURRENCES.none);
const summary = computed(() => props.stats?.summary ?? null);
const categories = computed(() => (props.budget.categories ?? []) as CategoryModel[]);
const rulesCount = computed(() => props.budget.rules?.length ?? 0);
// Several rules, or rules with no categories (tags, accounts, payees), read better as a rule count.
const showRulesCount = computed(() => rulesCount.value > 1 || (rulesCount.value > 0 && !categories.value.length));

const formatDate = (date: Date | string | undefined | null) => {
  if (!date) return null;
  return format(new Date(date), 'MMM d, yyyy');
};
</script>

<template>
  <Card
    :class="
      cn(
        'group relative flex cursor-pointer flex-col overflow-hidden transition-all duration-200 hover:border-white/20 hover:bg-white/2',
        isArchived && 'opacity-50',
      )
    "
  >
    <!-- Status Banner -->
    <div
      :class="
        cn(
          'flex items-center justify-center py-1.5 text-xs font-medium',
          isArchived
            ? 'bg-muted text-muted-foreground'
            : !timeStatus
              ? 'bg-muted/50 text-muted-foreground/70'
              : timeStatus.status === 'ended'
                ? 'bg-muted text-muted-foreground'
                : timeStatus.status === 'upcoming'
                  ? 'bg-blue-500/15 text-blue-400'
                  : 'bg-success-text/15 text-success-text',
        )
      "
    >
      <template v-if="isArchived">
        <ArchiveIcon class="mr-1 size-3" />
        {{ $t('budgets.list.archivedLabel') }}
      </template>
      <template v-else>
        {{ timeStatus?.text || $t('budgets.list.noTimePeriod') }}
      </template>
    </div>

    <div class="relative flex flex-1 flex-col p-4">
      <BudgetCardDropdown
        :budget-id="budget.id"
        :is-archived="isArchived"
        @edit="emit('edit')"
        @delete="emit('delete')"
        @archive="emit('archive')"
      />
      <!-- Header -->
      <div class="mb-3 flex items-center gap-3">
        <div class="bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg">
          <TagsIcon v-if="isCategoryBudget" class="text-muted-foreground size-5" />
          <WalletIcon v-else class="text-muted-foreground size-5" />
        </div>
        <div class="mt-auto min-w-0 flex-1">
          <h3 class="truncate pr-8 font-medium">{{ budget.name }}</h3>
          <div class="text-muted-foreground flex items-center gap-2 text-sm">
            <span v-if="budget.limitAmount">
              {{
                isRecurring
                  ? $t(`budgets.list.limitPerPeriod.${budget.recurrence}`, {
                      amount: formatBaseCurrency(budget.limitAmount),
                    })
                  : $t('budgets.list.limitLabel', { amount: formatBaseCurrency(budget.limitAmount) })
              }}
            </span>
            <template v-if="isCategoryBudget">
              <span v-if="budget.limitAmount && (categories.length || showRulesCount)">·</span>
              <span v-if="showRulesCount">{{ $t('budgets.rules.rulesCount', rulesCount) }}</span>
              <span v-else-if="categories.length">
                {{ $t('budgets.list.categoriesCount', { count: categories.length }) }}
              </span>
            </template>
            <template v-else-if="isStatsLoading">
              <span v-if="budget.limitAmount">·</span>
              <span class="bg-muted inline-block h-4 w-16 animate-pulse rounded" />
            </template>
            <template v-else>
              <span v-if="budget.limitAmount && summary?.transactionsCount">·</span>
              <span v-if="summary?.transactionsCount">
                {{ $t('budgets.list.transactionsCount', { count: summary.transactionsCount }) }}
              </span>
              <span v-else class="text-muted-foreground/60 italic">
                {{ $t('budgets.list.noTransactions') }}
              </span>
            </template>
          </div>
        </div>
      </div>

      <!-- Category chips -->
      <div v-if="categories.length" class="mb-3 flex flex-wrap gap-1">
        <span
          v-for="category in categories.slice(0, MAX_VISIBLE_CATEGORIES)"
          :key="category.id"
          class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
          :style="{ backgroundColor: category.color + '20', color: category.color }"
        >
          <CategoryCircle :category="category" class="size-2" />
          {{ category.name }}
        </span>
        <span
          v-if="categories.length > MAX_VISIBLE_CATEGORIES"
          class="text-muted-foreground bg-muted rounded-full px-2 py-0.5 text-xs"
        >
          +{{ categories.length - MAX_VISIBLE_CATEGORIES }}
        </span>
      </div>

      <!-- Date line: current period, budget range, or transaction range -->
      <div class="text-muted-foreground mb-3 flex items-center gap-1.5 text-xs">
        <template v-if="isRecurring">
          <RepeatIcon class="size-3.5" />
          <span>{{ $t(`budgets.recurrence.${budget.recurrence}`) }}</span>
          <span>·</span>
          <span v-if="isStatsLoading" class="bg-muted inline-block h-3 w-24 animate-pulse rounded" />
          <span v-else-if="stats?.period">
            {{ formatDate(stats.period.start) }}
            <ArrowRightIcon class="inline size-3" />
            {{ formatDate(stats.period.end) }}
          </span>
        </template>

        <template v-else-if="isCategoryBudget">
          <template v-if="budget.startDate || budget.endDate">
            <CalendarIcon class="size-3.5" />
            <span v-if="budget.startDate && budget.endDate">
              {{ formatDate(budget.startDate) }}
              <ArrowRightIcon class="inline size-3" />
              {{ formatDate(budget.endDate) }}
            </span>
            <span v-else>{{ formatDate(budget.startDate ?? budget.endDate) }}</span>
          </template>
          <span v-else class="text-muted-foreground/60 italic">{{ $t('budgets.list.autoTracked') }}</span>
        </template>

        <template v-else>
          <CalendarIcon class="size-3.5" />
          <span v-if="isStatsLoading" class="bg-muted inline-block h-3 w-24 animate-pulse rounded" />
          <span v-else-if="summary?.firstTransactionDate && summary?.lastTransactionDate">
            {{ formatDate(summary.firstTransactionDate) }}
            <ArrowRightIcon class="inline size-3" />
            {{ formatDate(summary.lastTransactionDate) }}
          </span>
          <span v-else-if="summary?.firstTransactionDate || summary?.lastTransactionDate">
            {{ formatDate(summary.firstTransactionDate ?? summary.lastTransactionDate) }}
          </span>
          <span v-else class="text-muted-foreground/60 italic">{{ $t('budgets.list.noTransactions') }}</span>
        </template>
      </div>

      <!-- Stats -->
      <BudgetStatsSkeleton v-if="isStatsLoading" :show-utilization="!!budget.limitAmount" />
      <template v-else>
        <BudgetCardStats
          :income="summary?.actualIncome ?? 0"
          :expense="summary?.actualExpense ?? 0"
          :balance="summary?.balance ?? 0"
        />
        <BudgetCardUtilization v-if="budget.limitAmount" :utilization-rate="summary?.utilizationRate ?? 0" />
      </template>
    </div>
  </Card>
</template>
