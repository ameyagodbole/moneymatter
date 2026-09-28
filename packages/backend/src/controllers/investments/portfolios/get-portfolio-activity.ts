import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { applyPaginationTransform, buildPagination, paginationFields } from '@controllers/helpers/pagination';
import { getPortfolioActivity } from '@services/investments/portfolios/get-portfolio-activity.service';
import { z } from 'zod';

export default createController(
  z.object({
    params: z.object({ id: recordId() }),
    query: z.object({ ...paginationFields }).transform(applyPaginationTransform),
  }),
  async ({ user, params, query }) => {
    const result = await getPortfolioActivity({
      userId: user.id,
      portfolioId: params.id,
      limit: query.limit,
      offset: query.offset,
    });

    return {
      data: {
        data: result.data,
        pagination: buildPagination(query, { totalCount: result.totalCount }),
      },
    };
  },
);
