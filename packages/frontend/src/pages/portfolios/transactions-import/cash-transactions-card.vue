<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/lib/ui/card';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useFormatCurrency } from '@/composable/formatters';
import { cn } from '@/lib/utils';
import {
  INVESTMENT_IMPORT_CASH_CONTRIBUTION,
  type InvestmentImportCashTransaction,
} from '@bt/shared/types/investments';
import { Trash2Icon, TriangleAlertIcon } from '@lucide/vue';
import { computed } from 'vue';

const TOOLTIP_CLASS = 'max-w-xs';

const props = defineProps<{
  cashTransactions: InvestmentImportCashTransaction[];
  skipTempIds: Set<string>;
}>();

const skippedDuplicateCount = computed(
  () =>
    props.cashTransactions.filter((cashTx) => cashTx.possibleDuplicateOf && props.skipTempIds.has(cashTx.tempId))
      .length,
);

const emit = defineEmits<{
  (e: 'toggle-skip', tempId: string): void;
  (e: 'delete', tempId: string): void;
}>();

const { formatAmountByCurrencyCode } = useFormatCurrency();
</script>

<template>
  <Card>
    <CardHeader class="flex flex-row items-center justify-between gap-2 space-y-0">
      <CardTitle class="text-base">
        {{ $t('investmentsImport.review.cash.title', { count: cashTransactions.length }) }}
      </CardTitle>
      <DesktopOnlyTooltip
        v-if="skippedDuplicateCount > 0"
        :content="
          $t('investmentsImport.review.cash.skippedDuplicates', skippedDuplicateCount, {
            named: { count: skippedDuplicateCount },
          })
        "
        :content-class-name="TOOLTIP_CLASS"
      >
        <span
          class="bg-warning/15 text-warning-text inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
        >
          <TriangleAlertIcon class="size-3.5" />
          {{ skippedDuplicateCount }}
        </span>
      </DesktopOnlyTooltip>
    </CardHeader>
    <CardContent class="divide-y p-0">
      <div
        v-for="cashTx in cashTransactions"
        :key="cashTx.tempId"
        :class="
          cn(
            'flex items-center gap-3 px-4 py-2 text-sm',
            cashTx.possibleDuplicateOf && (skipTempIds.has(cashTx.tempId) ? 'bg-muted/40 opacity-60' : 'bg-warning/10'),
          )
        "
      >
        <span class="text-muted-foreground w-24 shrink-0 tabular-nums">{{ cashTx.date }}</span>
        <div class="min-w-0 flex-1">
          <p class="truncate">{{ cashTx.description || '—' }}</p>
          <p class="text-muted-foreground text-xs">
            {{
              cashTx.kind === INVESTMENT_IMPORT_CASH_CONTRIBUTION
                ? $t('investmentsImport.categories.cashContribution')
                : $t('investmentsImport.categories.cashAdjustment')
            }}
          </p>
        </div>
        <span
          :class="
            cn(
              'shrink-0 font-medium tabular-nums',
              Number(cashTx.amount) > 0 ? 'text-app-income-color' : 'text-app-expense-color',
            )
          "
        >
          {{ formatAmountByCurrencyCode(Number(cashTx.amount), cashTx.currencyCode) }}
        </span>
        <DesktopOnlyTooltip
          v-if="cashTx.possibleDuplicateOf"
          :content="$t('investmentsImport.review.duplicateBadgeTooltip')"
          :content-class-name="TOOLTIP_CLASS"
        >
          <Button
            type="button"
            size="sm"
            :variant="skipTempIds.has(cashTx.tempId) ? 'secondary' : 'soft-destructive'"
            class="h-7 gap-1 px-2 text-xs"
            @click="emit('toggle-skip', cashTx.tempId)"
          >
            <TriangleAlertIcon class="size-3.5" />
            {{
              skipTempIds.has(cashTx.tempId)
                ? $t('investmentsImport.review.skipping')
                : $t('investmentsImport.review.possibleDup')
            }}
          </Button>
        </DesktopOnlyTooltip>
        <DesktopOnlyTooltip :content="$t('investmentsImport.review.deleteTransaction')">
          <Button
            type="button"
            variant="ghost-destructive"
            size="icon-sm"
            :aria-label="$t('investmentsImport.review.deleteTransaction')"
            @click="emit('delete', cashTx.tempId)"
          >
            <Trash2Icon class="size-4" />
          </Button>
        </DesktopOnlyTooltip>
      </div>
    </CardContent>
  </Card>
</template>
