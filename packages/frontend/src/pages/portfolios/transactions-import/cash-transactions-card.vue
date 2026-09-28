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

const TOOLTIP_CLASS = 'max-w-xs';

defineProps<{
  cashTransactions: InvestmentImportCashTransaction[];
  skipTempIds: Set<string>;
}>();

const emit = defineEmits<{
  (e: 'toggle-skip', tempId: string): void;
  (e: 'delete', tempId: string): void;
}>();

const { formatAmountByCurrencyCode } = useFormatCurrency();
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle class="text-base">
        {{ $t('investmentsImport.review.cash.title', { count: cashTransactions.length }) }}
      </CardTitle>
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
