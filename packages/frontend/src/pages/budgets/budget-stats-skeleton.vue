<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

withDefaults(
  defineProps<{
    showUtilization?: boolean;
    /** Number of stat columns to stand in for. */
    columns?: number;
  }>(),
  { showUtilization: false, columns: 3 },
);
</script>

<template>
  <!-- Stats skeleton -->
  <div
    class="border-border/50 mt-auto grid gap-2 border-t pt-3"
    :style="{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }"
  >
    <div v-for="i in columns" :key="i">
      <div class="bg-muted mb-1 h-3 w-12 animate-pulse rounded" />
      <div class="bg-muted h-5 w-16 animate-pulse rounded" />
    </div>
  </div>

  <!-- Utilization bar skeleton -->
  <div v-if="showUtilization" class="mt-3">
    <div class="mb-1 flex items-center justify-between text-xs">
      <span class="text-muted-foreground">{{ t('budgets.list.used') }}</span>
      <span class="bg-muted inline-block h-4 w-8 animate-pulse rounded" />
    </div>
    <div class="bg-muted h-1.5 overflow-hidden rounded-full">
      <div class="bg-muted-foreground/20 h-full w-1/3 animate-pulse rounded-full" />
    </div>
  </div>
</template>
