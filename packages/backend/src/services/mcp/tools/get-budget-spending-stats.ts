import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { serializeBudgetSpendingStats } from '@root/serializers';
import { getBudgetSpendingStats } from '@services/budgets/spending-stats';
import { z } from 'zod';

import { getUserId, jsonContent } from './helpers';

const inputSchema = {
  budgetId: recordId().describe('ID of the budget to retrieve spending stats for'),
  at: z
    .string()
    .datetime()
    .optional()
    .describe('Recurring budgets only: report the period containing this ISO 8601 instant. Default: now'),
};

export function registerGetBudgetSpendingStats(server: McpServer) {
  server.registerTool(
    'get_budget_spending_stats',
    {
      description:
        'Get spending statistics for a budget: spending broken down by category and a time-series of expense vs income over the budget period (for recurring budgets, the period containing `at`). Granularity is weekly for ranges ≤60 days, monthly otherwise. Amounts are decimals.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_budget_spending_stats', clientId: extra.authInfo?.clientId });

      const stats = await getBudgetSpendingStats({
        userId,
        budgetId: args.budgetId,
        at: args.at ? new Date(args.at) : undefined,
      });

      return jsonContent({ data: serializeBudgetSpendingStats(stats) });
    },
  );
}
