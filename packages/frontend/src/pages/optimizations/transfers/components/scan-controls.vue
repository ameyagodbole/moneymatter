<script setup lang="ts">
import AccountMultiSelectField from '@/components/fields/account-multi-select-field.vue';
import InputField from '@/components/fields/input-field.vue';
import { Button } from '@/components/lib/ui/button';
import { Checkbox } from '@/components/lib/ui/checkbox';
import { DateSelector, type DateSelectorPreset } from '@/components/lib/ui/date-selector';
import { useEarliestTransactionDate } from '@/composable/data-queries/earliest-transaction-date';
import type { Period } from '@/composable/use-period-navigation';
import { endOfMonth, endOfYear, startOfMonth, startOfYear, subMonths, subYears } from 'date-fns';
import { CalendarIcon, LoaderCircleIcon, PercentIcon, SearchIcon } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

defineProps<{
  isLoading: boolean;
}>();

const period = defineModel<Period>('period', { required: true });
const includeOutOfWallet = defineModel<boolean>('includeOutOfWallet', { required: true });
const accountIds = defineModel<string[]>('accountIds', { required: true });
const amountTolerancePercent = defineModel<string | number | null>('amountTolerancePercent', { required: true });
const dateToleranceDays = defineModel<string | number | null>('dateToleranceDays', { required: true });

defineEmits<{
  scan: [];
}>();

const { earliestDate } = useEarliestTransactionDate();

const quickPresets = computed<DateSelectorPreset[]>(() => [
  {
    label: t('optimizations.transferSuggestions.presets.last3Months'),
    getValue: () => ({
      from: startOfMonth(subMonths(new Date(), 2)),
      to: endOfMonth(new Date()),
    }),
  },
  {
    label: t('optimizations.transferSuggestions.presets.last6Months'),
    getValue: () => ({
      from: startOfMonth(subMonths(new Date(), 5)),
      to: endOfMonth(new Date()),
    }),
  },
  {
    label: t('optimizations.transferSuggestions.presets.lastYear'),
    getValue: () => ({
      from: startOfMonth(subMonths(new Date(), 11)),
      to: endOfMonth(new Date()),
    }),
  },
  {
    label: t('optimizations.transferSuggestions.presets.thisYear'),
    getValue: () => ({
      from: startOfYear(new Date()),
      to: new Date(),
    }),
  },
  {
    label: t('optimizations.transferSuggestions.presets.previousYear'),
    getValue: () => {
      const prevYear = subYears(new Date(), 1);
      return {
        from: startOfYear(prevYear),
        to: endOfYear(prevYear),
      };
    },
  },
]);
</script>

<template>
  <div class="flex flex-wrap items-center gap-3">
    <DateSelector
      v-model="period"
      :presets="quickPresets"
      :earliest-date="earliestDate"
      popover-class-name="md:min-w-[600px]"
    >
      <template #trigger="{ triggerText }">
        <Button variant="outline" size="sm" class="min-w-48 font-medium">
          <CalendarIcon class="mr-1.5 size-3.5" />
          {{ triggerText }}
        </Button>
      </template>
    </DateSelector>

    <AccountMultiSelectField v-model="accountIds" include-archived trigger-class="min-w-48" />

    <div class="flex items-center gap-2">
      <span class="text-sm">{{ $t('optimizations.transferSuggestions.tolerance.amountLabel') }}</span>
      <InputField
        v-model="amountTolerancePercent"
        type="number"
        class="w-24"
        only-positive
        :aria-label="$t('optimizations.transferSuggestions.tolerance.amountLabel')"
        :placeholder="$t('optimizations.transferSuggestions.tolerance.amountPlaceholder')"
        trailing-icon-css-class="px-3"
      >
        <template #iconTrailing>
          <PercentIcon class="text-muted-foreground size-3.5" />
        </template>
      </InputField>
    </div>

    <div class="flex items-center gap-2">
      <span class="text-sm">{{ $t('optimizations.transferSuggestions.tolerance.dateLabel') }}</span>
      <InputField
        v-model="dateToleranceDays"
        type="number"
        class="w-28"
        only-positive
        :aria-label="$t('optimizations.transferSuggestions.tolerance.dateLabel')"
        :placeholder="$t('optimizations.transferSuggestions.tolerance.datePlaceholder')"
        trailing-icon-css-class="px-3"
      >
        <template #iconTrailing>
          <span class="text-muted-foreground text-xs">{{
            $t('optimizations.transferSuggestions.tolerance.daysUnit')
          }}</span>
        </template>
      </InputField>
    </div>

    <label class="flex cursor-pointer items-center gap-2">
      <Checkbox v-model="includeOutOfWallet" />
      <span class="text-sm">{{ $t('optimizations.transferSuggestions.includeOutOfWallet') }}</span>
    </label>

    <Button :disabled="isLoading" class="gap-2" @click="$emit('scan')">
      <LoaderCircleIcon v-if="isLoading" class="size-4 animate-spin" />
      <SearchIcon v-else class="size-4" />
      {{ $t('common.actions.scan') }}
    </Button>
  </div>
</template>
