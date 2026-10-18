<script setup lang="ts">
import { useFormatCurrency } from '@/composable';
import { cn } from '@/lib/utils';
import { computed } from 'vue';

const props = defineProps<{
  /** Expenses minus income for the period on the card. */
  netSpend: number;
  /** Null when the budget has no limit. Negative once the limit is exceeded. */
  limitLeft: number | null;
}>();

const { formatBaseCurrency } = useFormatCurrency();

const isOver = computed(() => props.limitLeft !== null && props.limitLeft < 0);
</script>

<template>
  <div
    :class="cn('border-border/50 mt-auto grid gap-2 border-t pt-3', limitLeft === null ? 'grid-cols-1' : 'grid-cols-2')"
  >
    <div>
      <div class="text-muted-foreground text-[10px] tracking-wider uppercase">
        {{ $t('budgets.list.netSpend') }}
      </div>
      <div class="text-sm font-medium tabular-nums">{{ formatBaseCurrency(netSpend) }}</div>
    </div>
    <div v-if="limitLeft !== null">
      <div class="text-muted-foreground text-[10px] tracking-wider uppercase">
        {{ isOver ? $t('budgets.list.overLimit') : $t('budgets.list.limitLeft') }}
      </div>
      <div :class="cn('text-sm font-medium tabular-nums', isOver ? 'text-app-expense-color' : 'text-success-text')">
        {{ formatBaseCurrency(Math.abs(limitLeft)) }}
      </div>
    </div>
  </div>
</template>
