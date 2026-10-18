<script setup lang="ts">
import Card from '@/components/lib/ui/card/Card.vue';
import { HistoryIcon } from '@lucide/vue';
import { computed } from 'vue';

import type { LimitHistory } from './limit-history';

const props = defineProps<{
  history: LimitHistory;
}>();

const averageLabel = computed(() =>
  props.history.averageUsage === null ? '—' : `${Math.round(props.history.averageUsage * 100)}%`,
);
</script>

<template>
  <Card class="p-4">
    <div class="flex items-center gap-2">
      <HistoryIcon class="text-muted-foreground size-4" />
      <h3 class="text-sm font-medium">{{ $t('budgets.fit.historyTitle') }}</h3>
    </div>

    <p v-if="!history.periodsCount" class="text-muted-foreground mt-3 text-sm">{{ $t('budgets.fit.noHistory') }}</p>

    <div v-else class="mt-3 grid grid-cols-2 gap-4">
      <div>
        <div class="text-muted-foreground text-xs">{{ $t('budgets.fit.withinLimit') }}</div>
        <div class="mt-1 text-lg font-semibold tabular-nums">
          {{ $t('budgets.fit.withinCount', { within: history.withinCount, total: history.periodsCount }) }}
        </div>
      </div>
      <div>
        <div class="text-muted-foreground text-xs">{{ $t('budgets.fit.averageUsage') }}</div>
        <div class="mt-1 text-lg font-semibold tabular-nums">{{ averageLabel }}</div>
      </div>
    </div>
  </Card>
</template>
