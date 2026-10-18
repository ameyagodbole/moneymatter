<script setup lang="ts">
import type { BudgetPeriodsResponse } from '@/api/budgets';
import Card from '@/components/lib/ui/card/Card.vue';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useFormatCurrency } from '@/composable';
import { useDateLocale } from '@/composable/use-date-locale';
import { cn } from '@/lib/utils';
import { TargetIcon } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { type BudgetFit, type PeriodVariance, MIN_PERIODS_FOR_VERDICT } from './budget-fit';
import { formatBudgetPeriodLabel } from './budget-period-utils';

/** Over or under by this share of the limit or more fills a bar's half of the strip. */
const FULL_BAR_RATIO = 0.5;

const props = defineProps<{
  fit: BudgetFit;
  recurrence: BudgetPeriodsResponse['recurrence'];
}>();

const { t } = useI18n();
const { format } = useDateLocale();
const { formatBaseCurrency } = useFormatCurrency();

const barHeightPercent = (variance: PeriodVariance) => Math.min(Math.abs(variance.ratio) / FULL_BAR_RATIO, 1) * 100;

const percentLabel = (variance: PeriodVariance) => {
  const percent = Math.round(Math.abs(variance.ratio) * 100);
  if (percent === 0) return t('budgets.fit.onLimit');
  return variance.difference > 0 ? t('budgets.fit.overBy', { percent }) : t('budgets.fit.underBy', { percent });
};

const periodLabel = (variance: PeriodVariance) =>
  formatBudgetPeriodLabel({
    period: { start: variance.periodStart, end: variance.periodEnd },
    recurrence: props.recurrence,
    format,
  });

const axisLabel = (variance: PeriodVariance) =>
  format(new Date(variance.periodStart), props.recurrence === 'yearly' ? 'yyyy' : 'MMM');

const tooltip = (variance: PeriodVariance) =>
  t('budgets.fit.periodTooltip', {
    period: periodLabel(variance),
    spent: formatBaseCurrency(variance.spent),
    limit: formatBaseCurrency(variance.limit),
    difference: percentLabel(variance),
  });

const averageLabel = computed(() => {
  if (props.fit.averageUsage === null) return '—';
  return `${Math.round(props.fit.averageUsage * 100)}%`;
});
</script>

<template>
  <Card class="p-4">
    <div class="flex items-center gap-2">
      <TargetIcon class="text-muted-foreground size-4" />
      <h3 class="text-sm font-medium">{{ $t('budgets.fit.title') }}</h3>
    </div>

    <div v-if="!fit.periods.length" class="text-muted-foreground mt-3 text-sm">
      {{ $t('budgets.fit.noHistory') }}
    </div>

    <template v-else>
      <!-- Over / under per finished period -->
      <div class="mt-4 flex items-stretch gap-1.5 overflow-hidden">
        <DesktopOnlyTooltip v-for="variance in fit.periods" :key="variance.index" :content="tooltip(variance)">
          <div class="flex min-w-0 flex-1 flex-col items-center gap-1">
            <div class="relative flex h-16 w-full max-w-10 flex-col">
              <div class="flex flex-1 items-end justify-center">
                <div
                  v-if="variance.difference > 0"
                  class="bg-app-expense-color w-full rounded-t-sm"
                  :style="{ height: `${barHeightPercent(variance)}%` }"
                />
              </div>
              <div class="bg-border h-px w-full" />
              <div class="flex flex-1 items-start justify-center">
                <div
                  v-if="variance.difference < 0"
                  class="bg-success-text w-full rounded-b-sm"
                  :style="{ height: `${barHeightPercent(variance)}%` }"
                />
              </div>
            </div>
            <span
              :class="
                cn(
                  'text-[10px] font-medium tabular-nums',
                  variance.difference > 0 ? 'text-app-expense-color' : 'text-success-text',
                )
              "
            >
              {{ variance.difference > 0 ? '+' : variance.difference < 0 ? '−' : ''
              }}{{ Math.round(Math.abs(variance.ratio) * 100) }}%
            </span>
            <span class="text-muted-foreground truncate text-[10px]">{{ axisLabel(variance) }}</span>
          </div>
        </DesktopOnlyTooltip>
      </div>

      <div class="mt-4 grid grid-cols-2 gap-4">
        <div>
          <div class="text-muted-foreground text-xs">{{ $t('budgets.fit.withinLimit') }}</div>
          <div class="mt-1 text-lg font-semibold tabular-nums">
            {{
              $t('budgets.fit.withinCount', {
                within: fit.periods.length - fit.overCount,
                total: fit.periods.length,
              })
            }}
          </div>
        </div>
        <div>
          <div class="text-muted-foreground text-xs">{{ $t('budgets.fit.averageUsage') }}</div>
          <div class="mt-1 text-lg font-semibold tabular-nums">{{ averageLabel }}</div>
        </div>
      </div>

      <!-- Verdict -->
      <div
        :class="
          cn(
            'mt-4 rounded-md p-3 text-sm',
            fit.verdict === 'tooTight'
              ? 'bg-app-expense-color/10'
              : fit.verdict === 'roomy'
                ? 'bg-primary/10'
                : fit.verdict === 'realistic'
                  ? 'bg-success-text/10'
                  : 'bg-muted',
          )
        "
      >
        <div class="font-medium">{{ $t(`budgets.fit.verdict.${fit.verdict}.title`) }}</div>
        <p class="text-muted-foreground mt-0.5 text-xs">
          <template v-if="fit.verdict === 'insufficient'">
            {{ $t('budgets.fit.verdict.insufficient.description', { count: MIN_PERIODS_FOR_VERDICT }) }}
          </template>
          <template v-else-if="fit.verdict === 'tooTight'">
            {{
              $t('budgets.fit.verdict.tooTight.description', {
                over: fit.overCount,
                total: fit.periods.length,
                limit: formatBaseCurrency(fit.suggestedLimit ?? 0),
              })
            }}
          </template>
          <template v-else-if="fit.verdict === 'roomy'">
            {{ $t('budgets.fit.verdict.roomy.description', { limit: formatBaseCurrency(fit.suggestedLimit ?? 0) }) }}
          </template>
          <template v-else>{{ $t('budgets.fit.verdict.realistic.description') }}</template>
        </p>
      </div>
    </template>
  </Card>
</template>
