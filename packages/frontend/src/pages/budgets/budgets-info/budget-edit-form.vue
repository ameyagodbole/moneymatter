<script setup lang="ts">
import InputField from '@/components/fields/input-field.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import {
  BUDGET_RECURRENCES,
  BUDGET_ROLLOVERS,
  BUDGET_TYPES,
  type BudgetModel,
  type BudgetRuleGroup,
} from '@bt/shared/types';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import BudgetRulesEditor from '../components/budget-rules-editor.vue';
import { getEditableRules, getSavableRules } from '../components/budget-rules';
import { getBrowserTimezone } from '../use-recurrence-options';
import { type BudgetEditPayload, type BudgetSchedule, buildBudgetEditPayload } from './build-budget-edit-payload';
import BudgetScheduleFields from './shared/budget-schedule-fields.vue';

const props = defineProps<{
  budget: BudgetModel;
  isLoading: boolean;
}>();

const emit = defineEmits<{
  save: [payload: BudgetEditPayload];
}>();

const { t } = useI18n();

const formData = ref({
  name: '',
  limitAmount: null as number | null,
});
const rules = ref<BudgetRuleGroup[]>([]);
const schedule = ref<BudgetSchedule>({
  recurrence: BUDGET_RECURRENCES.none,
  rollover: BUDGET_ROLLOVERS.none,
  startDate: null,
  endDate: null,
});
const isScheduleDirty = ref(false);
const isCategoryBudget = computed(() => props.budget.type === BUDGET_TYPES.category);

// Initialize form data from budget prop on mount
const initFormData = () => {
  formData.value = {
    name: props.budget.name,
    limitAmount: props.budget.limitAmount ?? null,
  };
  rules.value = getEditableRules({ budget: props.budget });
  schedule.value = {
    recurrence: props.budget.recurrence,
    rollover: props.budget.rollover ?? BUDGET_ROLLOVERS.none,
    startDate: props.budget.startDate ? new Date(props.budget.startDate) : null,
    endDate: props.budget.endDate ? new Date(props.budget.endDate) : null,
  };
  isScheduleDirty.value = false;
};

const onScheduleUpdate = (value: BudgetSchedule) => {
  schedule.value = value;
  isScheduleDirty.value = true;
};

// A recurring budget's start date anchors every period, so it can't be cleared.
const isRulesValid = computed(() => !isCategoryBudget.value || getSavableRules({ rules: rules.value }).length > 0);

const isScheduleValid = computed(
  () => schedule.value.recurrence === BUDGET_RECURRENCES.none || !!schedule.value.startDate,
);

// Reset form when budget changes (e.g., after successful save)
watch(
  () => props.budget,
  () => {
    initFormData();
  },
  { immediate: true },
);

const handleSave = () => {
  emit(
    'save',
    buildBudgetEditPayload({
      name: formData.value.name,
      limitAmount: formData.value.limitAmount,
      ...(isCategoryBudget.value && { rules: getSavableRules({ rules: rules.value }) }),
      // Only a changed schedule is sent, so saving a rename never moves the periods to this browser's zone.
      ...(isScheduleDirty.value && { schedule: schedule.value, timezone: getBrowserTimezone() }),
    }),
  );
};
</script>

<template>
  <div class="grid gap-4">
    <InputField
      v-model="formData.name"
      :label="t('budgets.settings.nameLabel')"
      :placeholder="t('budgets.settings.namePlaceholder')"
      class="w-full"
      :disabled="isLoading"
    />
    <InputField
      v-model="formData.limitAmount"
      :label="
        schedule.recurrence === BUDGET_RECURRENCES.none
          ? t('budgets.settings.limitLabel')
          : t(`budgets.creation.limitPerPeriodLabel.${schedule.recurrence}`)
      "
      :placeholder="t('budgets.settings.limitPlaceholder')"
      type="number"
      only-positive
      class="w-full"
      :disabled="isLoading"
    />
    <BudgetRulesEditor
      v-if="isCategoryBudget"
      v-model="rules"
      :disabled="isLoading"
      :error-message="isRulesValid ? undefined : t('budgets.rules.required')"
    />
    <BudgetScheduleFields :model-value="schedule" :disabled="isLoading" @update:model-value="onScheduleUpdate" />
    <div class="flex justify-end">
      <Button @click="handleSave" :disabled="isLoading || !isScheduleValid || !isRulesValid">
        <template v-if="isLoading">{{ t('pages.budgetDetails.saving') }}</template>
        <template v-else>{{ t('pages.budgetDetails.saveChanges') }}</template>
      </Button>
    </div>
  </div>
</template>
