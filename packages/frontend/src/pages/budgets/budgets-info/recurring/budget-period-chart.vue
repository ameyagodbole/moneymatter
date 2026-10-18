<template>
  <div class="border-border bg-card rounded-lg border p-4">
    <h3 class="mb-4 text-lg font-semibold">{{ $t('budgets.recurring.periodChart.title') }}</h3>

    <div v-if="!periods.length" class="flex h-80 items-center justify-center">
      <div class="text-muted-foreground">{{ $t('budgets.recurring.periodChart.noData') }}</div>
    </div>

    <div v-else class="flex flex-col">
      <div ref="containerRef" class="relative h-80 w-full">
        <svg ref="svgRef" class="h-full w-full"></svg>

        <div
          v-show="tooltip.visible"
          ref="tooltipRef"
          class="pointer-events-none absolute z-10"
          :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
        >
          <ChartTooltip>
            <ChartTooltipHeader>{{ tooltip.label }}</ChartTooltipHeader>
            <ChartTooltipRow
              :color="tooltip.isOverLimit ? colors.over : colors.within"
              :label="$t('budgets.recurring.spent')"
              :value="formatBaseCurrency(tooltip.spent)"
            />
            <template v-if="tooltip.limitAmount !== null">
              <ChartTooltipRow
                :label="$t('budgets.recurring.limit')"
                :value="formatBaseCurrency(tooltip.limitAmount)"
              />
              <ChartTooltipDivider />
              <ChartTooltipRow
                :label="$t('budgets.recurring.used')"
                :value="`${Math.round(tooltip.utilizationRate ?? 0)}%`"
                :value-class="tooltip.isOverLimit ? 'text-destructive-text' : undefined"
              />
              <ChartTooltipRow
                :label="tooltip.isOverLimit ? $t('budgets.fit.overLabel') : $t('budgets.fit.underLabel')"
                :value="formatBaseCurrency(Math.abs(tooltip.spent - (tooltip.limitAmount ?? 0)))"
                :value-class="tooltip.isOverLimit ? 'text-destructive-text' : 'text-success-text'"
              />
            </template>
          </ChartTooltip>
        </div>
      </div>

      <!-- Legend -->
      <div class="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs">
        <div class="flex items-center gap-1.5">
          <span class="inline-block size-2.5 rounded-sm" :style="{ backgroundColor: colors.within }"></span>
          <span class="text-muted-foreground">{{ $t('budgets.recurring.spent') }}</span>
        </div>
        <div v-if="hasLimit" class="flex items-center gap-1.5">
          <span class="inline-block size-2.5 rounded-sm" :style="{ backgroundColor: colors.over }"></span>
          <span class="text-muted-foreground">{{ $t('budgets.recurring.overLimit') }}</span>
        </div>
        <div v-if="hasLimit" class="flex items-center gap-1.5">
          <span class="border-foreground/70 inline-block w-3 border-t-[1.5px] border-dashed"></span>
          <span class="text-muted-foreground">{{ $t('budgets.recurring.limit') }}</span>
        </div>
        <div v-if="averageSpent !== null" class="flex items-center gap-1.5">
          <span class="inline-block w-3 border-t-2 border-dashed" :style="{ borderColor: AVERAGE_LINE_COLOR }"></span>
          <span class="text-muted-foreground">{{ $t('budgets.recurring.averageSpent') }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { BudgetPeriodTotals, BudgetPeriodsResponse } from '@/api/budgets';
import { currentTheme } from '@/common/utils/color-theme';
import {
  ChartTooltip,
  ChartTooltipDivider,
  ChartTooltipHeader,
  ChartTooltipRow,
} from '@/components/common/charts/chart-tooltip';
import { useFormatCurrency } from '@/composable';
import { getChartColors } from '@/composable/charts/chart-colors';
import { formatAxisCurrency } from '@/composable/charts/format-axis-currency';
import { AVERAGE_LINE_COLOR, renderAverageLine } from '@/composable/charts/render-average-line';
import { useChartTooltipPosition } from '@/composable/charts/use-chart-tooltip-position';
import { useDateLocale } from '@/composable/use-date-locale';
import { useResizeObserver } from '@vueuse/core';
import * as d3 from 'd3';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { formatBudgetPeriodLabel } from './budget-period-utils';

const MAX_BAR_WIDTH = 60;
const LIMIT_LINE_WIDTH = 1.5;
const LIMIT_DASH = '3,3';
/** The average line needs at least this many finished periods to say anything. */
const MIN_PERIODS_FOR_AVERAGE = 2;
const UNSELECTED_BAR_OPACITY = 0.55;

const props = defineProps<{
  periods: BudgetPeriodTotals[];
  recurrence: BudgetPeriodsResponse['recurrence'];
  selectedIndex: number | null;
}>();

const emit = defineEmits<{
  select: [payload: { periodStart: string }];
}>();

const { t } = useI18n();
const { format } = useDateLocale();
const { formatBaseCurrency, getCurrencySymbol } = useFormatCurrency();

const containerRef = ref<HTMLDivElement | null>(null);
const svgRef = ref<SVGSVGElement | null>(null);
const tooltipRef = ref<HTMLDivElement | null>(null);

const tooltip = reactive({
  visible: false,
  x: 0,
  y: 0,
  label: '',
  spent: 0,
  limitAmount: null as number | null,
  utilizationRate: null as number | null,
  isOverLimit: false,
});

const { updateTooltipPosition } = useChartTooltipPosition({ containerRef, tooltipRef, tooltip });

const hasLimit = computed(() => props.periods.some((p) => p.limitAmount !== null));

const readCssColor = ({ name, fallback }: { name: string; fallback: string }) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

// Re-read on theme change so bar colours follow light/dark.
const colors = computed(() => {
  void currentTheme.value;
  return {
    within: readCssColor({ name: '--primary', fallback: 'rgb(59, 130, 246)' }),
    over: readCssColor({ name: '--destructive-text', fallback: 'rgb(239, 68, 68)' }),
  };
});

// Finished periods only: the current one is still filling up and would drag the average down.
const averageSpent = computed(() => {
  const now = new Date();
  const finished = props.periods.filter((period) => new Date(period.periodEnd) < now);
  if (finished.length < MIN_PERIODS_FOR_AVERAGE) return null;
  return finished.reduce((sum, period) => sum + period.spent, 0) / finished.length;
});

const isOverLimit = (period: BudgetPeriodTotals) => period.limitAmount !== null && period.spent > period.limitAmount;

const periodLabel = (period: BudgetPeriodTotals) =>
  formatBudgetPeriodLabel({
    period: { start: period.periodStart, end: period.periodEnd },
    recurrence: props.recurrence,
    format,
  });

const axisLabel = (period: BudgetPeriodTotals) => {
  const start = new Date(period.periodStart);
  return props.recurrence === 'yearly' ? format(start, 'yyyy') : format(start, 'MMM yy');
};

const showTooltip = ({ event, period }: { event: MouseEvent; period: BudgetPeriodTotals }) => {
  tooltip.label = periodLabel(period);
  tooltip.spent = period.spent;
  tooltip.limitAmount = period.limitAmount;
  tooltip.utilizationRate = period.utilizationRate;
  tooltip.isOverLimit = isOverLimit(period);
  tooltip.visible = true;
  updateTooltipPosition(event);
};

const renderChart = () => {
  if (!svgRef.value || !containerRef.value || !props.periods.length) return;

  const { grid, text, card } = getChartColors();
  const svg = d3.select(svgRef.value);
  svg.selectAll('*').remove();

  const width = containerRef.value.clientWidth;
  const height = containerRef.value.clientHeight;
  const isMobile = width < 400;
  const shouldRotateLabels = width / props.periods.length < 55;
  const margin = { top: 20, right: isMobile ? 10 : 20, left: isMobile ? 40 : 60, bottom: shouldRotateLabels ? 60 : 40 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const fontSize = isMobile ? '10px' : '12px';

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const xScale = d3
    .scaleBand()
    .domain(props.periods.map((p) => p.periodStart))
    .range([0, innerWidth])
    .padding(0.3);

  const yMax = Math.max(
    d3.max(props.periods, (p) => p.spent) ?? 0,
    d3.max(props.periods, (p) => p.limitAmount ?? 0) ?? 0,
  );
  const yScale = d3
    .scaleLinear()
    .domain([0, yMax || 1])
    .nice()
    .range([innerHeight, 0]);

  g.append('g')
    .call(
      d3
        .axisLeft(yScale)
        .tickSize(-innerWidth)
        .tickFormat(() => ''),
    )
    .call((gridAxis) => {
      gridAxis.select('.domain').remove();
      gridAxis.selectAll('.tick line').attr('stroke', grid).attr('stroke-opacity', 0.5);
    });

  const periodByStart = new Map(props.periods.map((p) => [p.periodStart, p]));

  g.append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(d3.axisBottom(xScale).tickFormat((d) => axisLabel(periodByStart.get(d as string)!)))
    .call((axis) => {
      axis.select('.domain').attr('stroke', grid);
      axis
        .selectAll('.tick text')
        .attr('fill', text)
        .attr('font-size', fontSize)
        .attr('transform', `rotate(${shouldRotateLabels ? -45 : 0})`)
        .attr('text-anchor', shouldRotateLabels ? 'end' : 'middle')
        .attr('dx', shouldRotateLabels ? '-0.5em' : '0')
        .attr('dy', shouldRotateLabels ? '0.5em' : '0.7em');
      axis.selectAll('.tick line').attr('stroke', grid);
    });

  g.append('g')
    .call(
      d3
        .axisLeft(yScale)
        .ticks(isMobile ? 5 : 6)
        .tickFormat((d) => formatAxisCurrency({ value: d as number, symbol: getCurrencySymbol() })),
    )
    .call((axis) => {
      axis.select('.domain').attr('stroke', grid);
      axis.selectAll('.tick text').attr('fill', text).attr('font-size', fontSize);
      axis.selectAll('.tick line').attr('stroke', grid);
    });

  const bandwidth = xScale.bandwidth();
  const barWidth = Math.min(bandwidth, MAX_BAR_WIDTH);
  const barOffset = (bandwidth - barWidth) / 2;

  g.selectAll('.bar')
    .data(props.periods)
    .enter()
    .append('rect')
    .attr('class', 'bar')
    .attr('x', (p) => (xScale(p.periodStart) ?? 0) + barOffset)
    .attr('width', barWidth)
    .attr('y', (p) => yScale(p.spent))
    .attr('height', (p) => innerHeight - yScale(p.spent))
    .attr('rx', 3)
    .attr('fill', (p) => (isOverLimit(p) ? colors.value.over : colors.value.within))
    .attr('opacity', (p) =>
      props.selectedIndex === null || p.index === props.selectedIndex ? 1 : UNSELECTED_BAR_OPACITY,
    )
    .style('cursor', 'pointer')
    .on('mouseenter', (event: MouseEvent, p) => showTooltip({ event, period: p }))
    .on('mousemove', (event: MouseEvent) => updateTooltipPosition(event))
    .on('mouseleave', () => {
      tooltip.visible = false;
    })
    .on('click', (_event: MouseEvent, p) => emit('select', { periodStart: p.periodStart }));

  const limits = props.periods.map((p) => p.limitAmount).filter((l): l is number => l !== null);
  const limitsVary = new Set(limits).size > 1;

  if (limitsVary) {
    // Rollover gives each period its own limit: mark it on each bar.
    g.selectAll('.limit-tick')
      .data(props.periods.filter((p) => p.limitAmount !== null))
      .enter()
      .append('line')
      .attr('class', 'limit-tick')
      .attr('x1', (p) => (xScale(p.periodStart) ?? 0) + barOffset - 4)
      .attr('x2', (p) => (xScale(p.periodStart) ?? 0) + barOffset + barWidth + 4)
      .attr('y1', (p) => yScale(p.limitAmount!))
      .attr('y2', (p) => yScale(p.limitAmount!))
      .attr('stroke', text)
      .attr('stroke-width', LIMIT_LINE_WIDTH)
      .attr('stroke-dasharray', LIMIT_DASH)
      .style('pointer-events', 'none');
  } else if (limits.length) {
    // The same limit every period reads as one reference line, labelled on the left so it
    // doesn't collide with the average line's label on the right.
    const y = yScale(limits[0]!);
    g.append('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', y)
      .attr('y2', y)
      .attr('stroke', text)
      .attr('stroke-width', LIMIT_LINE_WIDTH)
      .attr('stroke-dasharray', LIMIT_DASH)
      .style('pointer-events', 'none');
    g.append('text')
      .attr('x', 4)
      .attr('y', y - 6)
      .attr('fill', text)
      .attr('font-size', '11px')
      .attr('font-weight', 600)
      .style('pointer-events', 'none')
      .text(`${t('budgets.recurring.limit')}: ${formatBaseCurrency(limits[0]!)}`);
  }

  // Average spend of the finished periods, in the amber dashed style every chart uses for averages.
  if (averageSpent.value !== null) {
    renderAverageLine({
      g,
      innerWidth,
      y: yScale(averageSpent.value),
      label: `${t('budgets.recurring.averageSpent')}: ${formatBaseCurrency(averageSpent.value)}`,
      labelBackground: card,
    });
  }
};

useResizeObserver(containerRef, () => renderChart());
watch([() => props.periods, () => props.selectedIndex, averageSpent, currentTheme], () => renderChart(), {
  flush: 'post',
});
</script>
