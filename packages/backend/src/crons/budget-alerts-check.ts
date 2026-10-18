import { logger } from '@js/utils';
import { checkBudgetAlerts } from '@services/budgets/check-budget-alerts';
import { CronJob } from 'cron';

/**
 * Budget limit alerts cron.
 *
 * Runs hourly so an owner hears about crossing 80% / 100% of a limit the same day,
 * without hooking every transaction write. Each threshold notifies once per period.
 */
class BudgetAlertsCronService {
  private job: CronJob | null = null;

  public startCron(): void {
    if (this.job) {
      logger.info('Budget alerts cron is already running');
      return;
    }

    this.job = new CronJob(
      '20 * * * *', // Every hour at :20, clear of the jobs that run on the hour
      async () => {
        try {
          const result = await checkBudgetAlerts();
          logger.info('Budget alerts check completed', { ...result });
        } catch (error) {
          logger.error({ message: 'Budget alerts check failed', error: error as Error });
        }
      },
      null,
      false,
      'UTC',
    );

    this.job.start();
    logger.info('Budget alerts cron started - runs hourly at :20 UTC');
  }

  public stopCron(): void {
    if (this.job) {
      this.job.stop();
      this.job = null;
      logger.info('Budget alerts cron stopped');
    }
  }
}

export const budgetAlertsCron = new BudgetAlertsCronService();
