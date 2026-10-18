<script setup lang="ts">
import Card from '@/components/lib/ui/card/Card.vue';
import { useFormatCurrency } from '@/composable';
import { cn } from '@/lib/utils';
import { GaugeIcon } from '@lucide/vue';
import { computed } from 'vue';

import type { BudgetPace } from './budget-pace';

/** Within this share of the limit, spending reads as "on pace" rather than ahead or behind. */
const ON_PACE_TOLERANCE = 0.03;

const props = defineProps<{
  pace: BudgetPace;
  limit: number;
}>();

const { formatBaseCurrency } = useFormatCurrency();

const paceState = computed(() => {
  if (Math.abs(props.pace.paceDelta) <= props.limit * ON_PACE_TOLERANCE) return 'onPace';
  return props.pace.paceDelta > 0 ? 'ahead' : 'behind';
});
const isProjectedOver = computed(() => props.pace.projectedSpent > props.limit);
</script>

<template>
  <Card class="p-4">
    <div class="flex items-center gap-2">
      <GaugeIcon class="text-muted-foreground size-4" />
      <h3 class="text-sm font-medium">{{ $t('budgets.pace.title') }}</h3>
    </div>

    <div class="mt-3 grid grid-cols-1 gap-4 @md/recurring:grid-cols-3">
      <div>
        <div class="text-muted-foreground text-xs">{{ $t('budgets.pace.paceLabel') }}</div>
        <div
          :class="
            cn(
              'mt-1 text-lg font-semibold tabular-nums',
              paceState === 'ahead' ? 'text-warning-text' : paceState === 'behind' ? 'text-success-text' : '',
            )
          "
        >
          <template v-if="paceState === 'onPace'">{{ $t('budgets.pace.onPace') }}</template>
          <template v-else-if="paceState === 'ahead'">
            {{ $t('budgets.pace.aheadBy', { amount: formatBaseCurrency(pace.paceDelta) }) }}
          </template>
          <template v-else>{{ $t('budgets.pace.behindBy', { amount: formatBaseCurrency(-pace.paceDelta) }) }}</template>
        </div>
        <div class="text-muted-foreground mt-0.5 text-xs">
          {{ $t('budgets.pace.expectedByNow', { amount: formatBaseCurrency(pace.expectedSpent) }) }}
        </div>
      </div>

      <div>
        <div class="text-muted-foreground text-xs">{{ $t('budgets.pace.projectedLabel') }}</div>
        <div :class="cn('mt-1 text-lg font-semibold tabular-nums', isProjectedOver ? 'text-app-expense-color' : '')">
          {{ formatBaseCurrency(pace.projectedSpent) }}
        </div>
        <div class="text-muted-foreground mt-0.5 text-xs">
          {{ isProjectedOver ? $t('budgets.pace.projectedOver') : $t('budgets.pace.projectedWithin') }}
        </div>
      </div>

      <div>
        <div class="text-muted-foreground text-xs">{{ $t('budgets.pace.allowanceLabel') }}</div>
        <div class="mt-1 text-lg font-semibold tabular-nums">{{ formatBaseCurrency(pace.dailyAllowance) }}</div>
        <div class="text-muted-foreground mt-0.5 text-xs">
          {{ $t('budgets.pace.daysLeft', pace.daysLeft) }}
        </div>
      </div>
    </div>
  </Card>
</template>
