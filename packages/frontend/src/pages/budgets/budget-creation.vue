<script setup lang="ts">
import { createBudget } from '@/api/budgets';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import DateField from '@/components/fields/date-field.vue';
import InputField from '@/components/fields/input-field.vue';
import SelectField from '@/components/fields/select-field.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import Checkbox from '@/components/lib/ui/checkbox/Checkbox.vue';
import { Label } from '@/components/lib/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/lib/ui/radio-group';
import { useNotificationCenter } from '@/components/notification-center';
import { ApiErrorResponseError } from '@/js/errors';
import { trackAnalyticsEvent } from '@/lib/posthog';
import { cn } from '@/lib/utils';
import { useOnboardingStore } from '@/stores/onboarding';
import { BUDGET_RECURRENCES, BUDGET_ROLLOVERS, BUDGET_TYPES, type BudgetRuleGroup } from '@bt/shared/types';
import { useMutation, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import BudgetRulesEditor from './components/budget-rules-editor.vue';
import { createEmptyRule, getSavableRules } from './components/budget-rules';
import {
  type RecurrenceOption,
  type RolloverOption,
  getBrowserTimezone,
  useRecurrenceOptions,
  useRolloverOptions,
} from './use-recurrence-options';

const BUDGET_DEFAULT_VALUES: {
  id: string | null;
  name: string | null;
  status: string | null;
  type: BUDGET_TYPES;
  categoryIds: string[];
  startDate?: Date | null;
  endDate?: Date | null;
  limitAmount?: number | null;
  autoInclude?: boolean;
} = {
  id: null,
  name: null,
  status: null,
  type: BUDGET_TYPES.manual,
  categoryIds: [],
  startDate: null,
  endDate: null,
  limitAmount: null,
  autoInclude: false,
} as const;

const emits = defineEmits(['create-budget']);
const { t } = useI18n();
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();

const queryClient = useQueryClient();
const form = ref({ ...BUDGET_DEFAULT_VALUES });
const { recurrenceOptions, findRecurrenceOption } = useRecurrenceOptions();
const recurrence = ref<RecurrenceOption>(findRecurrenceOption(BUDGET_RECURRENCES.none));
const isRecurring = computed(() => recurrence.value.value !== BUDGET_RECURRENCES.none);
const { rolloverOptions, findRolloverOption } = useRolloverOptions();
const rollover = ref<RolloverOption>(findRolloverOption(BUDGET_ROLLOVERS.none));
const rules = ref<BudgetRuleGroup[]>([createEmptyRule()]);
const rulesFieldTouched = ref(false);

const { isPending: isMutating, mutate: createBudgetItem } = useMutation({
  mutationFn: createBudget,
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.budgetsList });
    trackAnalyticsEvent({ event: 'budget_created' });

    // Mark onboarding task as complete
    const onboardingStore = useOnboardingStore();
    onboardingStore.completeTask('create-budget');

    emits('create-budget');
    addSuccessNotification(t('budgets.creation.success'));
  },
  onError(error) {
    if (error instanceof ApiErrorResponseError) {
      addErrorNotification(error.data.message ?? '');
    } else {
      addErrorNotification(t('budgets.creation.error'));
    }
  },
});

const isDateExist = computed(() => !!form.value.startDate && !!form.value.endDate);
const isCategoryBudget = computed(() => form.value.type === BUDGET_TYPES.category);
const isCategoryValid = computed(() => !isCategoryBudget.value || getSavableRules({ rules: rules.value }).length > 0);
const categoryErrorMessage = computed(() => {
  if (!isCategoryBudget.value || !rulesFieldTouched.value || isCategoryValid.value) return undefined;
  return t('budgets.rules.required');
});
// A recurring budget's start date anchors every period, so it can't be left empty.
const isStartDateValid = computed(() => !isRecurring.value || !!form.value.startDate);
const isSubmitDisabled = computed(
  () => isMutating.value || !form.value.name || !isCategoryValid.value || !isStartDateValid.value,
);

const submit = () =>
  createBudgetItem({
    ...(form.value as any),
    recurrence: recurrence.value.value,
    rollover: isRecurring.value ? rollover.value.value : BUDGET_ROLLOVERS.none,
    timezone: getBrowserTimezone(),
    ...(isCategoryBudget.value && { rules: getSavableRules({ rules: rules.value }), categoryIds: undefined }),
    // Linking every transaction in a range up front only makes sense for a one-off budget.
    autoInclude: isRecurring.value ? false : form.value.autoInclude,
  });

const onRulesUpdate = (value: BudgetRuleGroup[]) => {
  rules.value = value;
  rulesFieldTouched.value = true;
};

const onBudgetTypeChange = (type: BUDGET_TYPES) => {
  form.value.type = type;
  // Reset touched state when switching types so user gets a fresh start
  if (type === BUDGET_TYPES.category) {
    rulesFieldTouched.value = false;
  }
};
</script>

<template>
  <form class="grid gap-4" @submit.prevent="submit">
    <InputField
      v-model="form.name"
      :label="$t('budgets.creation.nameLabel')"
      :placeholder="$t('budgets.creation.namePlaceholder')"
    />

    <div>
      <Label class="mb-2 block text-sm font-medium">{{ $t('budgets.creation.typeLabel') }}</Label>
      <RadioGroup
        :model-value="form.type"
        class="grid grid-cols-2 gap-3"
        @update:model-value="(v) => onBudgetTypeChange(v as BUDGET_TYPES)"
      >
        <Label
          :class="
            cn(
              'border-input hover:bg-accent hover:text-accent-foreground flex cursor-pointer flex-col gap-1 rounded-md border p-3 transition-colors',
              form.type === BUDGET_TYPES.manual && 'border-primary bg-primary/5',
            )
          "
        >
          <div class="flex items-center gap-2">
            <RadioGroupItem :value="BUDGET_TYPES.manual" />
            <span class="font-medium">{{ $t('budgets.creation.typeManual') }}</span>
          </div>
          <span class="text-muted-foreground pl-6 text-xs">{{ $t('budgets.creation.typeManualDescription') }}</span>
        </Label>
        <Label
          :class="
            cn(
              'border-input hover:bg-accent hover:text-accent-foreground flex cursor-pointer flex-col gap-1 rounded-md border p-3 transition-colors',
              form.type === BUDGET_TYPES.category && 'border-primary bg-primary/5',
            )
          "
        >
          <div class="flex items-center gap-2">
            <RadioGroupItem :value="BUDGET_TYPES.category" />
            <span class="font-medium">{{ $t('budgets.creation.typeCategory') }}</span>
          </div>
          <span class="text-muted-foreground pl-6 text-xs">{{ $t('budgets.creation.typeCategoryDescription') }}</span>
        </Label>
      </RadioGroup>
    </div>

    <BudgetRulesEditor
      v-if="isCategoryBudget"
      :model-value="rules"
      :error-message="categoryErrorMessage"
      @update:model-value="onRulesUpdate"
    />

    <div>
      <SelectField
        :model-value="recurrence"
        :values="recurrenceOptions"
        :label="$t('budgets.creation.recurrenceLabel')"
        :placeholder="$t('budgets.creation.recurrencePlaceholder')"
        @update:model-value="(option) => option && (recurrence = option)"
      />
      <p v-if="isRecurring" class="text-muted-foreground mt-1.5 text-xs">
        {{ $t(`budgets.creation.recurrenceHint.${recurrence.value}`) }}
      </p>
    </div>

    <div class="flex justify-between gap-4">
      <DateField
        :model-value="form.startDate ?? undefined"
        :calendar-options="{
          maxDate: form.endDate ?? undefined,
        }"
        :label="isRecurring ? $t('budgets.creation.startsOnLabel') : $t('budgets.creation.fromDateLabel')"
        @update:model-value="(v: Date | undefined) => (form.startDate = v ?? null)"
      />
      <DateField
        :model-value="form.endDate ?? undefined"
        :calendar-options="{
          minDate: form.startDate ?? undefined,
        }"
        :label="isRecurring ? $t('budgets.creation.endsOnLabel') : $t('budgets.creation.toDateLabel')"
        @update:model-value="(v: Date | undefined) => (form.endDate = v ?? null)"
      />
    </div>

    <div v-if="isRecurring">
      <SelectField
        :model-value="rollover"
        :values="rolloverOptions"
        :label="$t('budgets.rollover.label')"
        :placeholder="$t('budgets.rollover.placeholder')"
        @update:model-value="(option) => option && (rollover = option)"
      />
      <p class="text-muted-foreground mt-1.5 text-xs">{{ $t(`budgets.rollover.hint.${rollover.value}`) }}</p>
    </div>

    <div v-if="!isCategoryBudget && !isRecurring" class="flex gap-2">
      <label class="flex cursor-pointer items-center gap-2">
        <Checkbox v-model="form.autoInclude" :disabled="!isDateExist" />
        {{ $t('budgets.creation.autoIncludeLabel') }}
      </label>
    </div>

    <div>
      <InputField
        v-model.number="form.limitAmount"
        :label="
          isRecurring
            ? $t(`budgets.creation.limitPerPeriodLabel.${recurrence.value}`)
            : $t('budgets.creation.limitLabel')
        "
        :placeholder="$t('budgets.creation.limitPlaceholder')"
      />
    </div>

    <div class="mt-4">
      <Button :disabled="isSubmitDisabled" type="submit">{{ $t('budgets.creation.submitButton') }}</Button>
    </div>
  </form>
</template>
