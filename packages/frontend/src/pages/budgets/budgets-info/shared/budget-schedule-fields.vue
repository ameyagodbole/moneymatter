<script setup lang="ts">
import DateField from '@/components/fields/date-field.vue';
import SelectField from '@/components/fields/select-field.vue';
import { BUDGET_RECURRENCES } from '@bt/shared/types';
import { format } from 'date-fns';
import { computed } from 'vue';

import { useRecurrenceOptions } from '../../use-recurrence-options';
import type { BudgetSchedule } from '../build-budget-edit-payload';

const props = defineProps<{
  modelValue: BudgetSchedule;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: BudgetSchedule];
}>();

const { recurrenceOptions, findRecurrenceOption } = useRecurrenceOptions();

const isRecurring = computed(() => props.modelValue.recurrence !== BUDGET_RECURRENCES.none);
const selectedOption = computed(() => findRecurrenceOption(props.modelValue.recurrence));

const update = (patch: Partial<BudgetSchedule>) => emit('update:modelValue', { ...props.modelValue, ...patch });

const formatDate = (date: Date | null) => (date ? format(date, 'MMM d, yyyy') : null);
</script>

<template>
  <div class="grid gap-4">
    <div>
      <SelectField
        :model-value="selectedOption"
        :values="recurrenceOptions"
        :label="$t('budgets.creation.recurrenceLabel')"
        :placeholder="$t('budgets.creation.recurrencePlaceholder')"
        :disabled="disabled"
        @update:model-value="(option) => option && update({ recurrence: option.value })"
      />
      <p v-if="isRecurring" class="text-muted-foreground mt-1.5 text-xs">
        {{ $t(`budgets.creation.recurrenceHint.${modelValue.recurrence}`) }}
      </p>
    </div>

    <!-- A recurring budget's dates define its periods, so they are editable. -->
    <div v-if="isRecurring" class="grid grid-cols-2 gap-3">
      <DateField
        :model-value="modelValue.startDate ?? undefined"
        :calendar-options="{ maxDate: modelValue.endDate ?? undefined }"
        :label="$t('budgets.creation.startsOnLabel')"
        :disabled="disabled"
        @update:model-value="(v: Date | undefined) => update({ startDate: v ?? null })"
      />
      <DateField
        :model-value="modelValue.endDate ?? undefined"
        :calendar-options="{ minDate: modelValue.startDate ?? undefined }"
        :label="$t('budgets.creation.endsOnLabel')"
        :disabled="disabled"
        @update:model-value="(v: Date | undefined) => update({ endDate: v ?? null })"
      />
    </div>

    <div v-else class="grid grid-cols-2 gap-3">
      <div>
        <span class="text-muted-foreground mb-1.5 block text-sm font-medium">
          {{ $t('budgets.settings.startDateLabel') }}
        </span>
        <div
          class="border-input bg-muted/50 text-muted-foreground flex h-10 items-center rounded-md border px-3 text-sm"
        >
          {{ formatDate(modelValue.startDate) || $t('budgets.settings.notSet') }}
        </div>
      </div>
      <div>
        <span class="text-muted-foreground mb-1.5 block text-sm font-medium">
          {{ $t('budgets.settings.endDateLabel') }}
        </span>
        <div
          class="border-input bg-muted/50 text-muted-foreground flex h-10 items-center rounded-md border px-3 text-sm"
        >
          {{ formatDate(modelValue.endDate) || $t('budgets.settings.notSet') }}
        </div>
      </div>
    </div>
  </div>
</template>
