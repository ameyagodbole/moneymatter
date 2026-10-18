import { BUDGET_STATUSES, NOTIFICATION_PRIORITIES, NOTIFICATION_TYPES } from '@bt/shared/types';
import { t } from '@i18n/index';
import { logger } from '@js/utils/logger';
import Budgets from '@models/budget.model';
import Categories from '@models/categories.model';
import UserSettings from '@models/user-settings.model';
import * as notificationsService from '@services/notifications';
import { Op } from 'sequelize';

import { computeUtilizationRate } from './stats';
import { isRecurringBudget } from './utils/budget-periods';
import { resolveBudgetWindow } from './utils/budget-window';
import { collectBudgetEntries } from './utils/collect-budget-entries';
import { resolvePeriodLimits } from './utils/resolve-period-limits';

/** Share of the limit, in percent, at which the owner hears about it. Ascending. */
export const BUDGET_ALERT_THRESHOLDS = [80, 100] as const;

/** Key of the alert window: the period start for recurring budgets, `once` for one-off ones. */
const ONE_OFF_PERIOD_KEY = 'once';

export interface BudgetAlertPayload {
  budgetId: string;
  budgetName: string;
  threshold: number;
  utilizationRate: number;
  periodStart: string | null;
}

interface CheckBudgetAlertsResult {
  checked: number;
  notified: number;
  errors: number;
}

const loadAlertsEnabled = async ({ userIds }: { userIds: number[] }): Promise<Set<number>> => {
  const rows = await UserSettings.findAll({
    where: { userId: { [Op.in]: userIds } },
    attributes: ['userId', 'settings'],
  });
  const disabled = new Set(
    rows
      .filter((row) => {
        const prefs = (row.settings as { notifications?: { enabled?: boolean; types?: Record<string, boolean> } })
          ?.notifications;
        return prefs?.enabled === false || prefs?.types?.[NOTIFICATION_TYPES.budgetAlert] === false;
      })
      .map((row) => row.userId),
  );
  return new Set(userIds.filter((userId) => !disabled.has(userId)));
};

/**
 * The highest threshold `utilizationRate` has reached that wasn't already notified for
 * this window, or null. Crossing 80% and 100% at once sends only the 100% alert.
 */
export const pickAlertThreshold = ({
  utilizationRate,
  alreadyNotified,
}: {
  utilizationRate: number;
  alreadyNotified: number[];
}): number | null => {
  const reached = BUDGET_ALERT_THRESHOLDS.filter((threshold) => utilizationRate >= threshold);
  const highest = reached[reached.length - 1];
  if (highest === undefined || alreadyNotified.some((notified) => notified >= highest)) return null;
  return highest;
};

const checkBudget = async ({ budget, now }: { budget: Budgets; now: Date }): Promise<boolean> => {
  const window = resolveBudgetWindow({ budget, at: now });

  // A one-off budget only alerts inside its own dates; a recurring one, inside the current period.
  if (window.from && window.from > now) return false;
  if (!window.period && window.to && window.to < now) return false;

  const ownerUserId = budget.userId;
  const collected = await collectBudgetEntries({
    budget,
    ownerUserId,
    callerUserId: ownerUserId,
    isOwner: true,
    from: window.from,
    to: window.to,
  });

  const limits = window.period
    ? await resolvePeriodLimits({
        budget,
        uptoIndex: window.period.index,
        ownerUserId,
        callerUserId: ownerUserId,
        isOwner: true,
      })
    : null;
  const limitAmount = limits?.[window.period!.index]?.limit ?? budget.limitAmount?.toCents() ?? null;

  let expense = 0;
  let income = 0;
  for (const entry of collected.entries) {
    if (entry.isExpense) expense += entry.cents;
    else income += entry.cents;
  }
  for (const adjustment of collected.refundAdjustments) {
    if (adjustment.isExpense) expense -= adjustment.cents;
    else income -= adjustment.cents;
  }

  const utilizationRate = computeUtilizationRate({ income, expense, limitAmount });
  if (utilizationRate === null) return false;

  const periodKey = window.period ? window.period.start.toISOString() : ONE_OFF_PERIOD_KEY;
  const alreadyNotified = budget.alertState?.periodKey === periodKey ? budget.alertState.notifiedThresholds : [];
  const threshold = pickAlertThreshold({ utilizationRate, alreadyNotified });
  if (threshold === null) return false;

  const payload: BudgetAlertPayload = {
    budgetId: budget.id,
    budgetName: budget.name,
    threshold,
    utilizationRate: Math.round(utilizationRate),
    periodStart: window.period ? window.period.start.toISOString() : null,
  };
  const isOverLimit = threshold >= 100;

  await notificationsService.createNotification({
    userId: ownerUserId,
    type: NOTIFICATION_TYPES.budgetAlert,
    title: t({
      key: isOverLimit ? 'budgets.alerts.overLimitTitle' : 'budgets.alerts.nearLimitTitle',
      variables: { budgetName: budget.name },
    }),
    message: t({
      key: isOverLimit ? 'budgets.alerts.overLimitMessage' : 'budgets.alerts.nearLimitMessage',
      variables: { budgetName: budget.name, percent: String(payload.utilizationRate) },
    }),
    payload: payload as unknown as Record<string, unknown>,
    priority: isOverLimit ? NOTIFICATION_PRIORITIES.high : NOTIFICATION_PRIORITIES.normal,
  });

  await budget.update({
    alertState: {
      periodKey,
      notifiedThresholds: [...new Set([...alreadyNotified, ...BUDGET_ALERT_THRESHOLDS.filter((v) => v <= threshold)])],
    },
  });

  return true;
};

/**
 * Notifies budget owners when a budget's spending reaches 80% and then 100% of its limit,
 * once per threshold per period (recurring budgets start over each period). Skips users
 * who turned budget alerts off, archived budgets, and budgets without a limit.
 */
export const checkBudgetAlerts = async ({
  now = new Date(),
}: { now?: Date } = {}): Promise<CheckBudgetAlertsResult> => {
  const budgets = await Budgets.findAll({
    where: { status: BUDGET_STATUSES.active, limitAmount: { [Op.ne]: null } },
    include: [{ model: Categories, as: 'categories', attributes: ['id'] }],
  });

  const enabledUserIds = await loadAlertsEnabled({ userIds: [...new Set(budgets.map((b) => b.userId))] });
  const result: CheckBudgetAlertsResult = { checked: 0, notified: 0, errors: 0 };

  for (const budget of budgets) {
    if (!enabledUserIds.has(budget.userId)) continue;
    // A recurring budget whose series ended has no current period to watch.
    if (isRecurringBudget(budget) && budget.endDate && budget.endDate < now) continue;

    result.checked += 1;
    try {
      if (await checkBudget({ budget, now })) result.notified += 1;
    } catch (error) {
      result.errors += 1;
      logger.error({ message: `Budget alert check failed for budget ${budget.id}`, error: error as Error });
    }
  }

  return result;
};
