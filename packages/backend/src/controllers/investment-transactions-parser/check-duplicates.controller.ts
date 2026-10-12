import { ASSET_CLASS, INVESTMENT_TRANSACTION_CATEGORY, SECURITY_PROVIDER } from '@bt/shared/types/investments';
import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { detectInvestmentDuplicates, isDedupSide } from '@services/import-export/investment-transactions-parser';
import { findSecurityByIdentity } from '@services/investments/securities/identity';
import { z } from 'zod';

const decimalString = z.string().regex(/^-?\d+(\.\d+)?$/, 'Must be a decimal number string');

/**
 * Re-check one review-step holding for possible duplicates after the user
 * corrected its security. Extract only checks securities it resolved itself,
 * so a manual pick would otherwise never be compared against existing rows.
 */
export const checkDuplicatesController = createController(
  z.object({
    body: z.object({
      portfolioId: recordId(),
      security: z.object({
        securityId: recordId().nullable(),
        assetClass: z.nativeEnum(ASSET_CLASS),
        providerName: z.nativeEnum(SECURITY_PROVIDER),
        providerSymbol: z.string().min(1),
        symbol: z.string().min(1),
        currencyCode: z.string().min(1),
      }),
      transactions: z.array(
        z.object({
          tempId: z.string().min(1),
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
          side: z.nativeEnum(INVESTMENT_TRANSACTION_CATEGORY),
          price: decimalString,
          amount: decimalString,
        }),
      ),
    }),
  }),
  async ({ user, body }) => {
    const { portfolioId, security, transactions } = body;

    // Search picks never carry an id, so match them to an existing Security the
    // same way execute does (e.g. picking BRK-B finds the row past imports created).
    const securityId = security.securityId ?? (await findSecurityByIdentity(security))?.id;
    if (!securityId) return { data: { duplicates: [] } };

    const duplicates = await detectInvestmentDuplicates({
      userId: user.id,
      rows: transactions.flatMap(({ side, ...tx }) =>
        isDedupSide(side) ? [{ ...tx, side, portfolioId, securityId }] : [],
      ),
    });

    return { data: { duplicates } };
  },
);
