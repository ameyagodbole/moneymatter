import { ASSET_CLASS, SECURITY_PROVIDER } from '@bt/shared/types/investments';
import { sleep } from '@common/helpers';
import { logger } from '@js/utils';
import Holdings from '@models/investments/holdings.model';
import Portfolios from '@models/investments/portfolios.model';
import Securities from '@models/investments/securities.model';
import SecuritySplits, { SECURITY_SPLIT_SOURCE } from '@models/investments/security-splits.model';
import { dataProviderFactory } from '@services/investments/data-providers';
import { toProviderSymbol } from '@services/investments/data-providers/base-provider';
import type { YahooDataProvider } from '@services/investments/data-providers/yahoo-provider';
import { recalculateHolding } from '@services/investments/holdings/recalculation.service';
import { Big } from 'big.js';
import { Op } from 'sequelize';

import { loadSplitsBySecurity } from './load-splits';
import type { SplitEvent } from './share-basis';

/** Pause between Yahoo lookups, as the price sync does, to avoid throttling. */
const REQUEST_DELAY_MS = 150;

const isSameSplit = ({ a, b }: { a: SplitEvent; b: SplitEvent }): boolean =>
  a.date === b.date && new Big(a.numerator).eq(b.numerator) && new Big(a.denominator).eq(b.denominator);

/**
 * Fetch splits from Yahoo for stock securities, store the ones not yet known,
 * and recalculate every holding of a security whose splits changed. Without
 * `securityIds` it covers every security the price sync covers.
 *
 * Never throws: a failed lookup is logged and that security is retried on the
 * next sync, so split lookups can't fail the price sync that runs them.
 * See docs/specifications/stock-splits.md.
 */
export async function syncSecuritySplits({ securityIds }: { securityIds?: string[] } = {}): Promise<void> {
  if (process.env.YAHOO_FINANCE_ENABLED === 'false') return;

  try {
    const securities = await Securities.findAll({
      where: {
        assetClass: { [Op.ne]: ASSET_CLASS.crypto },
        ...(securityIds ? { id: { [Op.in]: securityIds } } : {}),
      },
      // Same scope as the price sync: holdings not excluded from syncing, in
      // portfolios that aren't deleted.
      include: securityIds
        ? []
        : [
            {
              model: Holdings,
              attributes: [],
              required: true,
              where: { excluded: false },
              include: [{ model: Portfolios, attributes: [], required: true }],
            },
          ],
      attributes: ['id', 'providerSymbol', 'priceSourceSymbol'],
      group: ['Securities.id'],
    });
    if (securities.length === 0) return;

    const yahoo = dataProviderFactory.getProvider(SECURITY_PROVIDER.yahoo) as YahooDataProvider;
    const known = await loadSplitsBySecurity({ securityIds: securities.map((security) => security.id) });

    const changedSecurityIds: string[] = [];
    for (const [index, security] of securities.entries()) {
      if (index > 0) await sleep({ ms: REQUEST_DELAY_MS });
      try {
        const splits = await yahoo.getSplits(toProviderSymbol(security.priceQuerySymbol));
        const knownSplits = known.get(security.id) ?? [];
        const newSplits = splits.filter(
          (split) => !knownSplits.some((existing) => isSameSplit({ a: existing, b: split })),
        );
        if (newSplits.length === 0) continue;

        await SecuritySplits.bulkCreate(
          newSplits.map((split) => ({ ...split, securityId: security.id, source: SECURITY_SPLIT_SOURCE.provider })),
          { updateOnDuplicate: ['numerator', 'denominator', 'updatedAt'] },
        );
        changedSecurityIds.push(security.id);
      } catch (error) {
        logger.warn('[Splits] Split lookup failed; will retry on the next sync', {
          securityId: security.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    for (const securityId of changedSecurityIds) {
      const holdings = await Holdings.findAll({ where: { securityId }, attributes: ['portfolioId', 'securityId'] });
      for (const holding of holdings) {
        await recalculateHolding({ portfolioId: holding.portfolioId, securityId });
      }
    }
    if (changedSecurityIds.length > 0) {
      logger.info(
        `[Splits] Stored new splits for ${changedSecurityIds.length} securities and recalculated their holdings`,
      );
    }
  } catch (error) {
    logger.error({ message: '[Splits] Split sync failed', error: error as Error });
  }
}
