import { BUDGET_RECURRENCES } from '@bt/shared/types';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

export interface RecurrenceOption {
  value: BUDGET_RECURRENCES;
  label: string;
}

/** IANA zone of this browser; recurring budget periods are cut at local midnight in it. */
export const getBrowserTimezone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Options for the "Repeats" select, plus a lookup from a stored value to its option. */
export const useRecurrenceOptions = () => {
  const { t } = useI18n();

  const recurrenceOptions = computed<RecurrenceOption[]>(() =>
    Object.values(BUDGET_RECURRENCES).map((value) => ({ value, label: t(`budgets.recurrence.${value}`) })),
  );

  const findRecurrenceOption = (value: BUDGET_RECURRENCES) =>
    recurrenceOptions.value.find((option) => option.value === value) ?? recurrenceOptions.value[0]!;

  return { recurrenceOptions, findRecurrenceOption };
};
