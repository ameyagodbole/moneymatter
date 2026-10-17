import { BUDGET_RECURRENCES } from '@bt/shared/types';

export interface BudgetSchedule {
  recurrence: BUDGET_RECURRENCES;
  startDate: Date | null;
  endDate: Date | null;
}

interface BudgetEditFormValues {
  name: string;
  limitAmount: number | null | undefined;
  categoryIds?: string[];
  /** Present only when the schedule (recurrence or its dates) was edited. */
  schedule?: BudgetSchedule;
  /** IANA zone the periods are cut in; sent with any schedule change. */
  timezone?: string;
}

export interface BudgetEditPayload {
  name: string;
  categoryIds?: string[];
  limitAmount?: number;
  recurrence?: BUDGET_RECURRENCES;
  timezone?: string;
  startDate?: string;
  endDate?: string | null;
}

/**
 * Builds the payload sent to the edit-budget endpoint from the form values.
 *
 * `limitAmount` is only included when it's a finite number greater than zero.
 * The endpoint validates `limitAmount` as a positive number and treats an
 * absent key as "leave the limit unchanged", so a budget with no limit must
 * omit the field entirely rather than send `0` (which fails validation).
 *
 * A schedule change sends the recurrence and timezone. Recurring budgets also send
 * their dates, with `endDate: null` clearing the end so the budget repeats until
 * archived; one-off budgets keep their stored dates.
 */
export const buildBudgetEditPayload = ({
  name,
  limitAmount,
  categoryIds,
  schedule,
  timezone,
}: BudgetEditFormValues): BudgetEditPayload => {
  const payload: BudgetEditPayload = { name, ...(categoryIds && { categoryIds }) };

  if (typeof limitAmount === 'number' && Number.isFinite(limitAmount) && limitAmount > 0) {
    payload.limitAmount = limitAmount;
  }

  if (schedule) {
    payload.recurrence = schedule.recurrence;
    if (timezone) payload.timezone = timezone;

    if (schedule.recurrence !== BUDGET_RECURRENCES.none) {
      if (schedule.startDate) payload.startDate = schedule.startDate.toISOString();
      payload.endDate = schedule.endDate ? schedule.endDate.toISOString() : null;
    }
  }

  return payload;
};
