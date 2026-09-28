import { getPortfolioActivity } from '@/api/portfolios';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { useOffsetHistoryQuery } from '@/composable/use-offset-history-query';
import { type MaybeRef, unref } from 'vue';

export const usePortfolioActivity = (portfolioId: MaybeRef<string>) =>
  useOffsetHistoryQuery({
    queryKey: [...VUE_QUERY_CACHE_KEYS.portfolioActivity, portfolioId],
    fetchPage: async ({ limit, offset }) => ({
      items: await getPortfolioActivity({ portfolioId: unref(portfolioId), limit, offset }),
    }),
  });
