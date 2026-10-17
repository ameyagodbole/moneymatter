import { BUDGET_RECURRENCES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { Money } from '@common/types/money';
import { isValidTimezone } from '@common/utils/zoned-time';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { editBudget } from '@services/budgets/edit-budget';
import { z } from 'zod';

import { getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  budgetId: recordId().describe('ID of the budget to update'),
  name: z.string().optional().describe('New budget name'),
  startDate: z.string().optional().describe('New start date (ISO 8601)'),
  endDate: z
    .string()
    .nullable()
    .optional()
    .describe('New end date (ISO 8601). Pass null to clear it so a recurring budget repeats until archived'),
  recurrence: z
    .enum([
      BUDGET_RECURRENCES.none,
      BUDGET_RECURRENCES.monthly,
      BUDGET_RECURRENCES.quarterly,
      BUDGET_RECURRENCES.yearly,
    ])
    .optional()
    .describe(
      'How often the budget resets. none is a one-off budget over its date range. For monthly/quarterly/yearly, startDate is required and its day anchors every period (e.g. the 25th → 25th–24th), limitAmount is per period, and endDate is optional (omit to repeat until archived).',
    ),
  timezone: z
    .string()
    .refine((timezone) => isValidTimezone({ timezone }), { message: 'Unknown IANA timezone' })
    .optional()
    .describe("IANA timezone the periods are cut in, e.g. 'Europe/Kyiv'. Default: UTC"),
  limitAmount: z
    .number()
    .optional()
    .describe("New spending limit as a decimal amount in the user's base currency (e.g. 500.00)"),
  autoInclude: z.boolean().optional().describe('Whether to auto-include transactions in the date range'),
  categoryIds: z
    .array(recordId())
    .optional()
    .describe(
      'Replace the linked category IDs (only applies to category-type budgets with a single rule; use rules otherwise)',
    ),
  rules: z
    .array(
      z.object({
        categoryIds: z.array(recordId()).default([]).describe('Categories (parents include their children)'),
        tagIds: z.array(recordId()).default([]).describe('Tags'),
        tagMatch: z
          .enum(['any', 'all'])
          .default('any')
          .describe('Whether the transaction needs any or all of the tags'),
        accountIds: z.array(recordId()).default([]).describe('Accounts'),
        payeeIds: z.array(recordId()).default([]).describe('Payees'),
      }),
    )
    .min(1)
    .max(20)
    .optional()
    .describe(
      'Category budgets only: matching rules. A transaction counts when any rule matches; a rule matches when all its non-empty conditions hold. A rule with categories counts only the matching parts of a split transaction; a rule without categories counts the whole transaction. Replaces all rules; overrides categoryIds.',
    ),
};

export function registerUpdateBudget(server: McpServer) {
  server.registerTool(
    'update_budget',
    {
      description:
        "Update an existing budget's name, date range, recurrence, spending limit, or linked categories. Returns the updated budget record.",
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      trackMcpToolUsed({ userId, tool: 'update_budget', clientId: extra.authInfo?.clientId });

      const budget = await editBudget({
        id: args.budgetId,
        userId,
        name: args.name,
        recurrence: args.recurrence,
        timezone: args.timezone,
        startDate: args.startDate,
        endDate: args.endDate,
        limitAmount: args.limitAmount !== undefined ? Money.fromDecimal(args.limitAmount) : undefined,
        autoInclude: args.autoInclude,
        categoryIds: args.categoryIds,
        rules: args.rules,
      });

      return jsonContent({ data: budget });
    },
  );
}
