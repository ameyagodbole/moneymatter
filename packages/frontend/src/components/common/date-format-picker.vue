<!--
  DateFormatPicker — the block beneath an importer's Date column that FORCES an
  explicit day/month-order confirmation for that column. The suggestion engine
  (suggest-date-field-order, mirroring the backend detector) only
  pre-highlights an option with a "Suggested" badge — it never commits.

  Single exception: a column made up entirely of year-first ISO / compact /
  English month-name shapes carries its order intrinsically, so the pick would
  be meaningless. That case auto-commits a deterministic order (the backend
  ignores it for those shapes) and renders a compact informational state
  instead of the select.

  "Custom format" replaces the order with a date-fns pattern the user types.

  The host passes the column's cells and binds `fieldOrder` / `pattern`; the
  preview and mismatch warning re-derive live from those cells.
-->
<template>
  <div v-if="analysis.isIsoOnly" class="text-muted-foreground flex items-center gap-2 text-xs">
    <CircleCheckIcon class="size-4 shrink-0" aria-hidden="true" />
    <span>
      {{
        hasMonthNames
          ? $t('pages.importExport.mapColumns.dateFormat.monthNamesDetected')
          : $t('pages.importExport.mapColumns.dateFormat.isoDetected')
      }}
    </span>
  </div>

  <template v-else>
    <div class="@container/date-format">
      <div class="grid gap-3 @md/date-format:grid-cols-2">
        <div>
          <p class="text-muted-foreground mb-1.5 text-xs font-medium">
            {{ $t('pages.importExport.mapColumns.dateFormat.label') }}
            <span class="text-destructive-text" aria-hidden="true">*</span>
          </p>
          <SelectField
            :model-value="selectedOption"
            :values="orderOptions"
            required
            class="w-full"
            :placeholder="$t('pages.importExport.mapColumns.dateFormat.placeholder')"
            @update:model-value="handleOrderChange"
          >
            <template #item="{ item, label }">
              <span class="flex items-center gap-2">
                {{ label }}
                <span
                  v-if="item.value === analysis.suggestion"
                  class="bg-primary/10 text-primary-text rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                >
                  {{ $t('pages.importExport.mapColumns.dateFormat.suggestedBadge') }}
                </span>
              </span>
            </template>
          </SelectField>

          <template v-if="isCustomFormat">
            <InputField
              :model-value="pattern"
              :label="$t('pages.importExport.mapColumns.dateFormat.customPatternLabel')"
              :placeholder="$t('pages.importExport.mapColumns.dateFormat.customPatternPlaceholder')"
              class="mt-2"
              @update:model-value="handlePatternChange"
            />
            <p class="text-muted-foreground mt-1 text-xs">
              {{ $t('pages.importExport.mapColumns.dateFormat.customPatternHint') }}
            </p>
          </template>
        </div>

        <!-- Live preview of the first few date cells under the current selection. -->
        <div v-if="previewCells.length > 0">
          <p class="text-muted-foreground mb-1.5 text-xs font-medium">
            {{ $t('pages.importExport.mapColumns.dateFormat.previewLabel') }}
          </p>
          <ul class="space-y-0.5 text-xs">
            <li v-for="cell in previewCells" :key="cell.raw" class="flex items-center gap-1.5">
              <span class="text-muted-foreground font-mono">{{ cell.raw }}</span>
              <span class="text-muted-foreground" aria-hidden="true">→</span>
              <span v-if="cell.formatted" class="font-medium">{{ cell.formatted }}</span>
              <span v-else class="text-warning-text">
                {{ $t('pages.importExport.mapColumns.dateFormat.previewUnrecognized') }}
              </span>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <!-- Cells that won't parse under the chosen order become invalid rows at import. -->
    <p v-if="mismatchCount > 0" class="text-warning-text mt-2 text-xs font-medium" role="alert">
      {{ $t('pages.importExport.mapColumns.dateFormat.mismatchWarning', { count: mismatchCount }, mismatchCount) }}
    </p>
    <p v-if="hasForeignMonthNames" class="text-warning-text mt-2 text-xs font-medium" role="alert">
      {{ $t('pages.importExport.mapColumns.dateFormat.nonEnglishMonthWarning') }}
    </p>
  </template>
</template>

<script setup lang="ts">
import InputField from '@/components/fields/input-field.vue';
import SelectField from '@/components/fields/select-field.vue';
import { hasNonEnglishMonthNames, isEnglishMonthNameDate } from '@bt/shared/import-export/date-engine';
import type { DateFieldOrder } from '@bt/shared/types';
import { CircleCheckIcon } from '@lucide/vue';
import { format } from 'date-fns';
import { computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  countMismatchedDateCells,
  detectDateSeparator,
  getBrowserLocaleFieldOrder,
  isDateFormatDecided,
  parseDateCellParts,
  suggestDateFieldOrder,
} from '@/common/utils/suggest-date-field-order';

const props = defineProps<{
  /** Non-empty cells of the date column across the FULL data set, so values
   *  that first appear in later rows still inform the suggestion. */
  values: string[];
}>();

const fieldOrder = defineModel<DateFieldOrder | null>('fieldOrder', { required: true });
/** `null` unless the custom format is chosen. */
const pattern = defineModel<string | null>('pattern', { required: true });

const { t } = useI18n();

const MAX_PREVIEW_CELLS = 3;

// Separator fallback for option examples when the column has no
// ambiguous-family cell to borrow one from.
const DEFAULT_SEPARATOR = '/';

/** The browser locale's conventional order — informs the suggestion badge only. */
const localeFallback = getBrowserLocaleFieldOrder();

const analysis = computed(() => suggestDateFieldOrder({ values: props.values, localeFallback }));

const hasMonthNames = computed(() => props.values.some((value) => isEnglishMonthNameDate({ value })));
const hasForeignMonthNames = computed(() => hasNonEnglishMonthNames({ values: props.values }));

// Intrinsically ordered shapes carry their order and the backend parser ignores
// `dateFieldOrder` for them, so a day/month pick would be meaningless noise.
// Commit a deterministic value to satisfy the wire contract and unblock Next.
watch(
  () => [props.values, analysis.value.isIsoOnly] as const,
  ([, isIsoOnly]) => {
    if (isIsoOnly && !fieldOrder.value) {
      fieldOrder.value = 'month-first';
    }
  },
  { immediate: true },
);

const CUSTOM_FORMAT = 'custom';

const isCustomFormat = computed(() => pattern.value !== null);

/** The pattern to parse with; `undefined` when the custom format isn't chosen or is still blank. */
const activePattern = computed(() => pattern.value?.trim() || undefined);

/** Preview and mismatch count only make sense once the format is fully chosen. */
const isFormatDecided = computed(() =>
  isDateFormatDecided({ dateFieldOrder: fieldOrder.value, datePattern: pattern.value }),
);

interface DateOrderOption {
  label: string;
  value: DateFieldOrder | typeof CUSTOM_FORMAT;
}

/** Concrete example (e.g. `31.12.2024`) rendered with the column's actual separator. */
const exampleFor = ({ order }: { order: DateFieldOrder }): string => {
  const separator = detectDateSeparator({ values: props.values }) ?? DEFAULT_SEPARATOR;
  return order === 'day-first' ? `31${separator}12${separator}2024` : `12${separator}31${separator}2024`;
};

const orderOptions = computed<DateOrderOption[]>(() => [
  {
    label: t('pages.importExport.mapColumns.dateFormat.dayFirstOption', {
      example: exampleFor({ order: 'day-first' }),
    }),
    value: 'day-first',
  },
  {
    label: t('pages.importExport.mapColumns.dateFormat.monthFirstOption', {
      example: exampleFor({ order: 'month-first' }),
    }),
    value: 'month-first',
  },
  {
    label: t('pages.importExport.mapColumns.dateFormat.customOption'),
    value: CUSTOM_FORMAT,
  },
]);

const selectedOption = computed<DateOrderOption | null>(() => {
  const selected = isCustomFormat.value ? CUSTOM_FORMAT : fieldOrder.value;
  return orderOptions.value.find((option) => option.value === selected) ?? null;
});

const handleOrderChange = (option: DateOrderOption | null) => {
  if (option?.value === CUSTOM_FORMAT) {
    // A pattern replaces the order, so any order satisfies the wire contract.
    fieldOrder.value = 'month-first';
    pattern.value ??= '';
    return;
  }
  fieldOrder.value = option?.value ?? null;
  pattern.value = null;
};

const handlePatternChange = (value: string | number | null) => {
  pattern.value = String(value ?? '');
};

interface PreviewCell {
  raw: string;
  /** Human-readable parse result, or `null` when the cell fails under the selection. */
  formatted: string | null;
}

/** First few distinct raw cells with their parse result under the current selection. */
const previewCells = computed<PreviewCell[]>(() => {
  const order = fieldOrder.value;
  if (!order || !isFormatDecided.value) return [];

  const cells: PreviewCell[] = [];
  const seen = new Set<string>();
  for (const raw of props.values) {
    if (seen.has(raw)) continue;
    seen.add(raw);
    const parts = parseDateCellParts({ value: raw, fieldOrder: order, pattern: activePattern.value });
    cells.push({
      raw,
      formatted: parts ? format(new Date(parts.year, parts.month - 1, parts.day), 'MMM d, yyyy') : null,
    });
    if (cells.length >= MAX_PREVIEW_CELLS) break;
  }
  return cells;
});

const mismatchCount = computed<number>(() => {
  const order = fieldOrder.value;
  if (!order || !isFormatDecided.value) return 0;
  return countMismatchedDateCells({ values: props.values, fieldOrder: order, pattern: activePattern.value });
});
</script>
