<template>
  <div>
    <!-- Loading -->
    <div v-if="isLoading" class="space-y-3">
      <div v-for="i in SKELETON_ROWS" :key="i" class="flex items-center justify-between py-2">
        <div class="space-y-1.5">
          <div class="bg-muted h-4 w-24 animate-pulse rounded" />
          <div class="bg-muted h-3 w-16 animate-pulse rounded" />
        </div>
        <div class="bg-muted h-4 w-20 animate-pulse rounded" />
      </div>
    </div>

    <!-- Empty state -->
    <div v-else-if="!activityQuery.items.value.length" class="flex flex-col items-center gap-2 py-8 text-center">
      <div class="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-full">
        <ListIcon class="size-5" />
      </div>
      <p class="text-sm font-medium">{{ $t('portfolioDetail.cashBalances.activity.emptyState') }}</p>
    </div>

    <!-- Activity list -->
    <div v-else class="divide-y">
      <div
        v-for="item in activityQuery.items.value"
        :key="`${item.type}-${item.id}`"
        class="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
      >
        <div class="flex min-w-0 items-center gap-3">
          <div
            :class="
              cn(
                'flex size-8 shrink-0 items-center justify-center rounded-full',
                getCashDirection(item) > 0 && 'bg-app-income-color/10 text-app-income-color',
                getCashDirection(item) < 0 && 'bg-app-expense-color/10 text-app-expense-color',
                getCashDirection(item) === 0 && 'bg-app-transfer-color/10 text-app-transfer-color',
              )
            "
          >
            <component :is="getIcon(item)" class="size-4" />
          </div>
          <div class="min-w-0">
            <p class="flex items-center gap-2 text-sm font-medium">
              <span class="truncate">{{ getLabel(item) }}</span>
              <span
                v-if="item.type === 'transfer' && item.isAdjustment"
                class="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium tracking-wide uppercase"
              >
                {{ $t('portfolioDetail.cashBalances.cashTransactions.adjustmentBadge') }}
              </span>
            </p>
            <p class="text-muted-foreground truncate text-xs">
              {{ formatDate(item.date) }}
              <span v-if="getDetail(item)"> &middot; {{ getDetail(item) }}</span>
            </p>
          </div>
        </div>

        <div class="shrink-0 text-right">
          <template v-if="item.cashChanges.length">
            <div v-for="(change, index) in item.cashChanges" :key="change.currencyCode">
              <p
                :class="
                  cn(
                    'text-sm font-semibold tabular-nums',
                    Number(change.amount) >= 0 ? 'text-app-income-color' : 'text-app-expense-color',
                  )
                "
              >
                {{ Number(change.amount) > 0 ? '+' : ''
                }}{{ formatAmountByCurrencyCode(Number(change.amount), change.currencyCode) }}
              </p>
              <p class="text-muted-foreground text-xs tabular-nums">
                {{
                  $t('portfolioDetail.cashBalances.activity.balanceAfter', {
                    amount: formatAmountByCurrencyCode(
                      Number(item.balancesAfter[index]?.amount ?? 0),
                      change.currencyCode,
                    ),
                  })
                }}
              </p>
            </div>
          </template>
          <p v-else class="text-muted-foreground text-sm">—</p>
        </div>
      </div>
    </div>

    <div v-if="activityQuery.hasNextPage.value" ref="sentinelRef" class="flex justify-center p-3">
      <Loader2Icon v-if="activityQuery.isFetchingNextPage.value" class="text-muted-foreground size-4 animate-spin" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { usePortfolioActivity } from '@/composable/data-queries/portfolio-activity';
import { useFormatCurrency } from '@/composable/formatters';
import { cn } from '@/lib/utils';
import { INVESTMENT_TRANSACTION_CATEGORY, type PortfolioActivityItem } from '@bt/shared/types/investments';
import { useIntersectionObserver } from '@vueuse/core';
import { format } from 'date-fns';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CoinsIcon,
  ListIcon,
  Loader2Icon,
  RefreshCwIcon,
  SplitIcon,
  type LucideIcon,
} from '@lucide/vue';
import { computed, ref, toRef } from 'vue';
import { useI18n } from 'vue-i18n';

const SKELETON_ROWS = 3;

const props = defineProps<{ portfolioId: string }>();

const { t } = useI18n();
const { formatAmountByCurrencyCode } = useFormatCurrency();

const activityQuery = usePortfolioActivity(toRef(props, 'portfolioId'));
const isLoading = computed(() => !activityQuery.isFetched.value);

const sentinelRef = ref<HTMLElement | null>(null);
useIntersectionObserver(sentinelRef, ([entry]) => {
  if (entry?.isIntersecting && activityQuery.hasNextPage.value && !activityQuery.isFetchingNextPage.value) {
    activityQuery.fetchNextPage();
  }
});

const formatDate = (date: string) => format(new Date(date), 'MMM d, yyyy');

/** Sign of the row's cash effect: 1 in, -1 out, 0 none or mixed (currency exchange). */
const getCashDirection = (item: PortfolioActivityItem): number => {
  if (item.cashChanges.length !== 1) return 0;
  return Math.sign(Number(item.cashChanges[0]!.amount));
};

const getIcon = (item: PortfolioActivityItem): LucideIcon => {
  if (item.type === 'split') return SplitIcon;
  if (item.type === 'transfer' && item.direction === 'exchange') return RefreshCwIcon;
  if (item.type === 'investment' && item.category === INVESTMENT_TRANSACTION_CATEGORY.dividend) return CoinsIcon;
  const direction = getCashDirection(item);
  if (direction > 0) return ArrowDownIcon;
  if (direction < 0) return ArrowUpIcon;
  return RefreshCwIcon;
};

const getLabel = (item: PortfolioActivityItem): string => {
  if (item.type === 'investment') {
    return [item.category.toUpperCase(), item.securitySymbol].filter(Boolean).join(' ');
  }
  if (item.type === 'split') return ['SPLIT', item.securitySymbol].filter(Boolean).join(' ');
  if (item.direction === 'exchange') return t('portfolioDetail.cashBalances.cashTransactions.exchange');
  if (item.counterparty === 'external') {
    return item.direction === 'in'
      ? t('portfolioDetail.cashBalances.cashTransactions.deposit')
      : t('portfolioDetail.cashBalances.cashTransactions.withdrawal');
  }
  return item.direction === 'in'
    ? t('portfolioDetail.cashBalances.cashTransactions.transferIn')
    : t('portfolioDetail.cashBalances.cashTransactions.transferOut');
};

/** Secondary line: units × price for trades, the ratio for splits, the description for cash rows. */
const getDetail = (item: PortfolioActivityItem): string | null => {
  if (item.type === 'transfer') return item.description;
  if (item.type === 'split') return `${Number(item.numerator)}:${Number(item.denominator)}`;
  if (item.category !== INVESTMENT_TRANSACTION_CATEGORY.buy && item.category !== INVESTMENT_TRANSACTION_CATEGORY.sell) {
    return null;
  }
  return `${Number(item.quantity)} × ${Number(item.price)}`;
};
</script>
