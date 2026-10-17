import { BUDGET_RECURRENCES, BUDGET_STATUSES, BUDGET_TYPES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { Money } from '@common/types/money';
import { isValidTimezone } from '@common/utils/zoned-time';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createBudget } from '@services/budgets/create-budget';
import { z } from 'zod';

import { getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  name: z.string().describe('Budget name'),
  status: z
    .enum([BUDGET_STATUSES.active, BUDGET_STATUSES.archived, BUDGET_STATUSES.closed])
    .optional()
    .describe('Budget status (default: active)'),
  type: z
    .enum([BUDGET_TYPES.manual, BUDGET_TYPES.category])
    .optional()
    .describe(
      'Budget type: manual (transactions linked explicitly) or category (auto-tracks by category). Default: manual',
    ),
  categoryIds: z.array(recordId()).optional().describe('Category IDs to link (only used when type is "category")'),
  recurrence: z
    .enum([
      BUDGET_RECURRENCES.none,
      BUDGET_RECURRENCES.monthly,
      BUDGET_RECURRENCES.quarterly,
      BUDGET_RECURRENCES.yearly,
    ])
    .optional()
    .describe(
      'How often the budget resets. none (default) is a one-off budget over its date range. For monthly/quarterly/yearly, startDate is required and its day anchors every period (e.g. the 25th → 25th–24th), limitAmount is per period, and endDate is optional (omit to repeat until archived).',
    ),
  timezone: z
    .string()
    .refine((timezone) => isValidTimezone({ timezone }), { message: 'Unknown IANA timezone' })
    .optional()
    .describe("IANA timezone the periods are cut in, e.g. 'Europe/Kyiv'. Default: UTC"),
  startDate: z.string().optional().describe('Budget start date (ISO 8601)'),
  endDate: z.string().optional().describe('Budget end date (ISO 8601)'),
  autoInclude: z
    .boolean()
    .optional()
    .describe('Auto-include transactions in the date range when creating (manual budgets only)'),
  limitAmount: z
    .number()
    .optional()
    .describe("Spending limit as a decimal amount in the user's base currency (e.g. 500.00)"),
};

export function registerCreateBudget(server: McpServer) {
  server.registerTool(
    'create_budget',
    {
      description:
        'Create a new budget with an optional spending limit, date range or monthly/quarterly/yearly recurrence, and linked categories. Returns the created budget with its ID, status, type, and associated categories.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      trackMcpToolUsed({ userId, tool: 'create_budget', clientId: extra.authInfo?.clientId });

      const budget = await createBudget({
        userId,
        name: args.name,
        status: args.status ?? BUDGET_STATUSES.active,
        type: args.type,
        categoryIds: args.categoryIds,
        recurrence: args.recurrence,
        timezone: args.timezone,
        startDate: args.startDate ? new Date(args.startDate) : undefined,
        endDate: args.endDate ? new Date(args.endDate) : undefined,
        autoInclude: args.autoInclude,
        limitAmount: args.limitAmount !== undefined ? Money.fromDecimal(args.limitAmount) : undefined,
      });

      return jsonContent({ data: budget });
    },
  );
}
