import {
  CATEGORIZATION_SKIP_REASON,
  CATEGORIZATION_SOURCE,
  CATEGORIZATION_TRIGGER,
  type RecordId,
} from '@bt/shared/types';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { SSE_EVENT_TYPES, sseManager } from '@services/common/sse';
import * as helpers from '@tests/helpers';
import { VALID_GEMINI_API_KEY, createGeminiMock } from '@tests/mocks/gemini/mock-api';
import { startOfDay, subDays } from 'date-fns';

import { CATEGORIZATION_SCOPE } from './categorization-scope';
import { categorizeTransactions } from './categorization-service';

const RUN_SETTLE_TIMEOUT_MS = 15_000;
const TEST_TIMEOUT_MS = 60_000;

async function seedTransactions({
  count,
  categoryId,
  accountId,
}: {
  count: number;
  categoryId: RecordId;
  accountId: RecordId;
}): Promise<string[]> {
  const today = startOfDay(new Date());
  const ids: string[] = [];

  for (let index = 0; index < count; index++) {
    const [transaction] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId,
        categoryId,
        amount: 100 + index,
        note: `Ambiguous payment ${index}`,
        time: subDays(today, index).toISOString(),
      }),
      raw: true,
    });
    ids.push(transaction.id);
  }

  return ids;
}

async function runCategorization() {
  const trigger = await helpers.triggerAiCategorization();
  expect(trigger.statusCode).toBe(200);
  expect(trigger.body.response.enqueued).toBe(true);

  await helpers.waitForCategorizationStatus({
    predicate: (status) => status.status === 'idle',
    timeoutMs: RUN_SETTLE_TIMEOUT_MS,
  });
}

describe('AI categorization skip stamping', () => {
  let originalGeminiApiKey: string | undefined;

  beforeEach(() => {
    originalGeminiApiKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = VALID_GEMINI_API_KEY;
  });

  afterEach(() => {
    if (originalGeminiApiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalGeminiApiKey;
    }
  });

  it(
    'stamps declined and unanswered rows with the run stamp instead of failing them',
    async () => {
      global.mswMockServer.use(
        createGeminiMock({ categorizations: { 1: 1 }, skips: { 2: CATEGORIZATION_SKIP_REASON.transfer } }),
      );

      const user = await helpers.getUserInfo({ raw: true });
      const defaultCategoryId = user.defaultCategoryId as RecordId;
      const account = await helpers.createAccount({ raw: true });
      const seededIds = await seedTransactions({ count: 4, categoryId: defaultCategoryId, accountId: account.id });

      await runCategorization();

      const rows = await helpers.getTransactionsByIds({ ids: seededIds, raw: true });
      expect(rows).toHaveLength(4);
      for (const row of rows) {
        expect(row.categorizationMeta?.source).toBe(CATEGORIZATION_SOURCE.ai);
        expect(row.categorizationMeta?.trigger).toBe(CATEGORIZATION_TRIGGER.manual);
        expect(row.categorizationMeta?.categorizedAt).toBe(rows[0]!.categorizationMeta?.categorizedAt);
      }

      const categorized = rows.filter((row) => !row.categorizationMeta?.skipReason);
      expect(categorized).toHaveLength(1);

      const declined = rows.filter((row) => row.categorizationMeta?.skipReason === CATEGORIZATION_SKIP_REASON.transfer);
      expect(declined).toHaveLength(1);

      const unanswered = rows.filter(
        (row) => row.categorizationMeta?.skipReason === CATEGORIZATION_SKIP_REASON.unspecified,
      );
      expect(unanswered).toHaveLength(2);

      // A skip must never touch the category itself.
      for (const row of [...declined, ...unanswered]) {
        expect(row.categoryId).toBe(defaultCategoryId);
      }

      // Skipped rows still sit in the default category, so the candidates list keeps offering them.
      const candidates = await helpers.getAiCategorizationCandidates({ raw: true });
      expect(candidates.totalCount).toBe(3);

      const history = await helpers.getAiCategorizationHistory({ raw: true });
      expect(history.totalCount).toBe(1);
      expect(history.items[0]!.transactionCount).toBe(4);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'retries rows the AI skipped when the user triggers another run',
    async () => {
      global.mswMockServer.use(
        createGeminiMock({
          skips: { 1: CATEGORIZATION_SKIP_REASON.unclear, 2: CATEGORIZATION_SKIP_REASON.no_fit },
        }),
      );

      const user = await helpers.getUserInfo({ raw: true });
      const defaultCategoryId = user.defaultCategoryId as RecordId;
      const account = await helpers.createAccount({ raw: true });
      const seededIds = await seedTransactions({ count: 2, categoryId: defaultCategoryId, accountId: account.id });

      await runCategorization();

      const skippedRows = await helpers.getTransactionsByIds({ ids: seededIds, raw: true });
      expect(skippedRows.every((row) => row.categorizationMeta?.skipReason)).toBe(true);
      const firstRunStamp = skippedRows[0]!.categorizationMeta?.categorizedAt;

      global.mswMockServer.use(createGeminiMock({ categorizations: { 1: 1, 2: 1 } }));
      await runCategorization();

      const retriedRows = await helpers.getTransactionsByIds({ ids: seededIds, raw: true });
      for (const row of retriedRows) {
        expect(row.categorizationMeta?.source).toBe(CATEGORIZATION_SOURCE.ai);
        expect(row.categorizationMeta?.skipReason).toBeUndefined();
        expect(row.categorizationMeta?.categorizedAt).not.toBe(firstRunStamp);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'leaves rows the AI skipped alone on the sync and import auto-path',
    async () => {
      global.mswMockServer.use(createGeminiMock({ skips: { 1: CATEGORIZATION_SKIP_REASON.unclear } }));

      const user = await helpers.getUserInfo({ raw: true });
      const defaultCategoryId = user.defaultCategoryId as RecordId;
      const account = await helpers.createAccount({ raw: true });
      const seededIds = await seedTransactions({ count: 1, categoryId: defaultCategoryId, accountId: account.id });

      await runCategorization();

      global.mswMockServer.use(createGeminiMock({ categorizations: { 1: 1 } }));
      for (const scope of [CATEGORIZATION_SCOPE.anyCategory, CATEGORIZATION_SCOPE.defaultCategoryOnly]) {
        const result = await categorizeTransactions({ userId: user.id, transactionIds: seededIds, scope });
        expect(result.successful).toHaveLength(0);
        expect(result.skipped).toHaveLength(0);
      }

      const [row] = await helpers.getTransactionsByIds({ ids: seededIds, raw: true });
      expect(row!.categorizationMeta?.skipReason).toBe(CATEGORIZATION_SKIP_REASON.unclear);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'completes with every row skipped when the model answers in prose',
    async () => {
      const sseSpy = jest.spyOn(sseManager, 'sendToUser');
      global.mswMockServer.use(
        createGeminiMock({
          rawText: [
            "I'm unable to categorize any of these transactions with confidence.",
            '- **t1**: External P2P transfer via BLIK mobile payment system',
            '- **t2-t3**: Internal card-to-card transfers (test amounts)',
            "None of the transactions have a merchant, so I can't assign categories.",
          ].join('\n'),
        }),
      );

      const user = await helpers.getUserInfo({ raw: true });
      const defaultCategoryId = user.defaultCategoryId as RecordId;
      const account = await helpers.createAccount({ raw: true });
      const seededIds = await seedTransactions({ count: 3, categoryId: defaultCategoryId, accountId: account.id });

      await runCategorization();

      const rows = await helpers.getTransactionsByIds({ ids: seededIds, raw: true });
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        expect(row.categoryId).toBe(defaultCategoryId);
        expect(row.categorizationMeta?.source).toBe(CATEGORIZATION_SOURCE.ai);
        expect(row.categorizationMeta?.skipReason).toBe(CATEGORIZATION_SKIP_REASON.unspecified);
      }

      // The run must end as a clean completion with skips, not as a silent all-failed one.
      const completedEvents = sseSpy.mock.calls
        .map(([args]) => args)
        .filter(
          (args) =>
            args.event === SSE_EVENT_TYPES.AI_CATEGORIZATION_PROGRESS &&
            (args.data as { status: string }).status === 'completed',
        );
      expect(completedEvents).toHaveLength(1);
      expect(completedEvents[0]!.data).toMatchObject({
        status: 'completed',
        processedCount: 3,
        totalCount: 3,
        failedCount: 0,
        skippedCount: 3,
      });

      sseSpy.mockRestore();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'leaves unanswered rows unstamped when the response was cut off by the token limit',
    async () => {
      global.mswMockServer.use(createGeminiMock({ categorizations: { 1: 1 }, finishReason: 'MAX_TOKENS' }));

      const user = await helpers.getUserInfo({ raw: true });
      const defaultCategoryId = user.defaultCategoryId as RecordId;
      const account = await helpers.createAccount({ raw: true });
      const seededIds = await seedTransactions({ count: 3, categoryId: defaultCategoryId, accountId: account.id });

      await runCategorization();

      const rows = await helpers.getTransactionsByIds({ ids: seededIds, raw: true });
      const stamped = rows.filter((row) => row.categorizationMeta !== null);
      expect(stamped).toHaveLength(1);
      expect(stamped[0]!.categorizationMeta?.skipReason).toBeUndefined();

      // The model never saw a verdict through for the rest, so they stay candidates.
      const candidates = await helpers.getAiCategorizationCandidates({ raw: true });
      expect(candidates.totalCount).toBe(2);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'leaves unanswered rows unstamped when the response ended on a content filter',
    async () => {
      global.mswMockServer.use(createGeminiMock({ categorizations: { 1: 1 }, finishReason: 'SAFETY' }));

      const user = await helpers.getUserInfo({ raw: true });
      const defaultCategoryId = user.defaultCategoryId as RecordId;
      const account = await helpers.createAccount({ raw: true });
      const seededIds = await seedTransactions({ count: 3, categoryId: defaultCategoryId, accountId: account.id });

      await runCategorization();

      const rows = await helpers.getTransactionsByIds({ ids: seededIds, raw: true });
      const stamped = rows.filter((row) => row.categorizationMeta !== null);
      expect(stamped).toHaveLength(1);
      expect(stamped[0]!.categorizationMeta?.skipReason).toBeUndefined();

      // A filtered answer proves nothing about the unmentioned rows, so they stay candidates.
      const candidates = await helpers.getAiCategorizationCandidates({ raw: true });
      expect(candidates.totalCount).toBe(2);
    },
    TEST_TIMEOUT_MS,
  );
});
