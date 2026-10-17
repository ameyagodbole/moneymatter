<script setup lang="ts">
import type { BudgetPeriod, BudgetPeriodsResponse } from '@/api/budgets';
import { Button } from '@/components/lib/ui/button';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useDateLocale } from '@/composable/use-date-locale';
import { ChevronLeftIcon, ChevronRightIcon } from '@lucide/vue';
import { computed } from 'vue';

import { formatBudgetPeriodLabel, getAdjacentPeriodAt, hasNextPeriod } from './budget-period-utils';

const props = defineProps<{
  /** The period on screen, from the budget stats. Null while loading. */
  period: BudgetPeriod | null;
  recurrence: BudgetPeriodsResponse['recurrence'];
  seriesEnd: Date | string | null | undefined;
  /** Whether a specific period is selected (as opposed to following the current one). */
  isPinned: boolean;
}>();

const emit = defineEmits<{
  'update:at': [value: Date | undefined];
}>();

const { format } = useDateLocale();

const label = computed(() =>
  props.period ? formatBudgetPeriodLabel({ period: props.period, recurrence: props.recurrence, format }) : '',
);
const canGoBack = computed(() => !!props.period && props.period.index > 0);
const canGoForward = computed(
  () => !!props.period && hasNextPeriod({ period: props.period, seriesEnd: props.seriesEnd }),
);

const step = ({ direction }: { direction: 'previous' | 'next' }) => {
  if (!props.period) return;
  emit('update:at', getAdjacentPeriodAt({ period: props.period, direction }));
};
</script>

<template>
  <div class="mb-6 flex flex-wrap items-center gap-2">
    <DesktopOnlyTooltip :content="$t('budgets.recurring.previousPeriodButton')">
      <Button
        variant="outline"
        size="icon-sm"
        :disabled="!canGoBack"
        :aria-label="$t('budgets.recurring.previousPeriodButton')"
        @click="step({ direction: 'previous' })"
      >
        <ChevronLeftIcon class="size-4" />
      </Button>
    </DesktopOnlyTooltip>

    <span class="min-w-40 text-center text-sm font-medium tabular-nums">
      <span v-if="period">{{ label }}</span>
      <span v-else class="bg-muted inline-block h-4 w-28 animate-pulse rounded align-middle" />
    </span>

    <DesktopOnlyTooltip :content="$t('budgets.recurring.nextPeriodButton')">
      <Button
        variant="outline"
        size="icon-sm"
        :disabled="!canGoForward"
        :aria-label="$t('budgets.recurring.nextPeriodButton')"
        @click="step({ direction: 'next' })"
      >
        <ChevronRightIcon class="size-4" />
      </Button>
    </DesktopOnlyTooltip>

    <Button v-if="isPinned" variant="ghost" size="sm" @click="emit('update:at', undefined)">
      {{ $t('budgets.recurring.currentPeriodButton') }}
    </Button>
  </div>
</template>
