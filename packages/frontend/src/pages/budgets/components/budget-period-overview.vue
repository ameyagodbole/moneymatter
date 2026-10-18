<script setup lang="ts">
import Card from '@/components/lib/ui/card/Card.vue';
import { useFormatCurrency } from '@/composable';
import { cn } from '@/lib/utils';
import { CalendarRangeIcon } from '@lucide/vue';

import type { PeriodOverviewGroup } from '../budget-period-overview';

defineProps<{
  groups: PeriodOverviewGroup[];
}>();

const { formatBaseCurrency } = useFormatCurrency();

const usedPercent = (group: PeriodOverviewGroup) =>
  group.limit > 0 ? Math.round((group.spent / group.limit) * 100) : 0;
</script>

<template>
  <Card v-if="groups.length" class="@container/overview mb-4 p-4">
    <div class="mb-3 flex items-center gap-2">
      <CalendarRangeIcon class="text-muted-foreground size-4" />
      <h2 class="text-sm font-medium">{{ $t('budgets.overview.title') }}</h2>
    </div>

    <div class="grid grid-cols-1 gap-4 @md/overview:grid-cols-3">
      <div v-for="group in groups" :key="group.recurrence">
        <div class="text-muted-foreground text-xs">
          {{ $t(`budgets.overview.period.${group.recurrence}`) }} ·
          {{ $t('budgets.overview.budgetsCount', group.budgetsCount) }}
        </div>
        <div class="mt-1 flex items-baseline gap-1.5">
          <span class="text-lg font-semibold tabular-nums">{{ formatBaseCurrency(group.spent) }}</span>
          <span class="text-muted-foreground text-sm tabular-nums">
            {{ $t('budgets.overview.ofLimit', { amount: formatBaseCurrency(group.limit) }) }}
          </span>
        </div>
        <div class="bg-muted mt-2 h-1.5 overflow-hidden rounded-full">
          <div
            :class="cn('h-full rounded-full', group.spent > group.limit ? 'bg-app-expense-color' : 'bg-primary')"
            :style="{ width: `${Math.min(usedPercent(group), 100)}%` }"
          />
        </div>
        <div v-if="group.overLimitCount" class="text-app-expense-color mt-1 text-xs font-medium">
          {{ $t('budgets.overview.overLimitCount', group.overLimitCount) }}
        </div>
      </div>
    </div>
  </Card>
</template>
