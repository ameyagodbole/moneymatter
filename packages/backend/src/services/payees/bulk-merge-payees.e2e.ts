import { TRANSACTION_TYPES } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';

async function createPayee({ name, defaultCategoryId }: { name: string; defaultCategoryId?: string }) {
  return helpers.createPayee({
    payload: helpers.buildPayeePayload({ name, defaultCategoryId }),
    raw: true,
  });
}

async function createCategory({ name }: { name: string }) {
  return helpers.addCustomCategory({ name, color: '#AABBCC', raw: true });
}

describe('POST /payees/merge (bulk merge)', () => {
  it('moves every source transaction and alias into the target and deletes the sources', async () => {
    const account = await helpers.createAccount({ raw: true });
    const [target, sourceA, sourceB] = await Promise.all([
      createPayee({ name: 'Amazon' }),
      createPayee({ name: 'AMZN Mktp' }),
      createPayee({ name: 'Amazon.com' }),
    ]);

    const transactionIds: string[] = [];
    for (const payeeId of [target.id, sourceA.id, sourceB.id]) {
      const [tx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
          payeeId,
        }),
        raw: true,
      });
      transactionIds.push(tx!.id);
    }

    const merged = await helpers.bulkMergePayees({
      sourceIds: [sourceA.id, sourceB.id],
      targetId: target.id,
      raw: true,
    });
    expect(merged.id).toBe(target.id);

    for (const id of transactionIds) {
      const tx = await helpers.getTransactionById({ id, raw: true });
      expect(tx?.payeeId).toBe(target.id);
    }

    const aliasNames = (merged.aliases ?? []).map((alias) => alias.normalizedName);
    expect(aliasNames).toEqual(expect.arrayContaining([sourceA.normalizedName, sourceB.normalizedName]));

    for (const source of [sourceA, sourceB]) {
      const gone = await helpers.getPayeeById({ id: source.id, raw: false });
      expect(gone.statusCode).toBe(ERROR_CODES.NotFoundError);
    }
  });

  it('merges sources that have no transactions', async () => {
    const [target, source] = await Promise.all([createPayee({ name: 'Netflix' }), createPayee({ name: 'NFLX' })]);

    const merged = await helpers.bulkMergePayees({
      sourceIds: [source.id],
      targetId: target.id,
      raw: true,
    });

    expect(merged.id).toBe(target.id);
    const gone = await helpers.getPayeeById({ id: source.id, raw: false });
    expect(gone.statusCode).toBe(ERROR_CODES.NotFoundError);
  });

  describe('default category', () => {
    it("keeps the target's category when it has one", async () => {
      const [targetCategory, sourceCategory] = await Promise.all([
        createCategory({ name: 'Shopping' }),
        createCategory({ name: 'Groceries' }),
      ]);
      const [target, source] = await Promise.all([
        createPayee({
          name: 'Target Co',
          defaultCategoryId: targetCategory.id,
        }),
        createPayee({
          name: 'Source Co',
          defaultCategoryId: sourceCategory.id,
        }),
      ]);

      const merged = await helpers.bulkMergePayees({
        sourceIds: [source.id],
        targetId: target.id,
        raw: true,
      });

      expect(merged.defaultCategoryId).toBe(targetCategory.id);
    });

    it('takes the first source category when the target has none', async () => {
      const [firstCategory, secondCategory] = await Promise.all([
        createCategory({ name: 'First' }),
        createCategory({ name: 'Second' }),
      ]);
      const [target, noCategory, first, second] = await Promise.all([
        createPayee({ name: 'Uncategorized Target' }),
        createPayee({ name: 'No Category Source' }),
        createPayee({
          name: 'First Source',
          defaultCategoryId: firstCategory.id,
        }),
        createPayee({
          name: 'Second Source',
          defaultCategoryId: secondCategory.id,
        }),
      ]);

      const merged = await helpers.bulkMergePayees({
        sourceIds: [noCategory.id, first.id, second.id],
        targetId: target.id,
        raw: true,
      });

      expect(merged.defaultCategoryId).toBe(firstCategory.id);
    });

    it('applies an explicit category, including null to clear it', async () => {
      const [targetCategory, chosenCategory] = await Promise.all([
        createCategory({ name: 'Kept' }),
        createCategory({ name: 'Chosen' }),
      ]);
      const [target, source, otherTarget, otherSource] = await Promise.all([
        createPayee({
          name: 'Explicit Target',
          defaultCategoryId: targetCategory.id,
        }),
        createPayee({ name: 'Explicit Source' }),
        createPayee({
          name: 'Cleared Target',
          defaultCategoryId: targetCategory.id,
        }),
        createPayee({ name: 'Cleared Source' }),
      ]);

      const chosen = await helpers.bulkMergePayees({
        sourceIds: [source.id],
        targetId: target.id,
        defaultCategoryId: chosenCategory.id,
        raw: true,
      });
      expect(chosen.defaultCategoryId).toBe(chosenCategory.id);

      const cleared = await helpers.bulkMergePayees({
        sourceIds: [otherSource.id],
        targetId: otherTarget.id,
        defaultCategoryId: null,
        raw: true,
      });
      expect(cleared.defaultCategoryId).toBeNull();
    });

    it('rejects a category the user does not own', async () => {
      const [target, source] = await Promise.all([
        createPayee({ name: 'Foreign Cat Target' }),
        createPayee({ name: 'Foreign Cat Source' }),
      ]);

      const response = await helpers.bulkMergePayees({
        sourceIds: [source.id],
        targetId: target.id,
        defaultCategoryId: generateRandomRecordId(),
        raw: false,
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });

  describe('validation', () => {
    it('rejects an empty source list', async () => {
      const target = await createPayee({ name: 'Lonely' });

      const response = await helpers.bulkMergePayees({
        sourceIds: [],
        targetId: target.id,
        raw: false,
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('rejects a target that is also listed as a source', async () => {
      const [target, source] = await Promise.all([createPayee({ name: 'Self A' }), createPayee({ name: 'Self B' })]);

      const response = await helpers.bulkMergePayees({
        sourceIds: [source.id, target.id],
        targetId: target.id,
        raw: false,
      });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      const sourceStillThere = await helpers.getPayeeById({
        id: source.id,
        raw: false,
      });
      expect(sourceStillThere.statusCode).toBe(200);
    });

    it('merges nothing when one source is missing', async () => {
      const [target, source] = await Promise.all([
        createPayee({ name: 'Atomic Target' }),
        createPayee({ name: 'Atomic Source' }),
      ]);

      const response = await helpers.bulkMergePayees({
        sourceIds: [source.id, generateRandomRecordId()],
        targetId: target.id,
        raw: false,
      });

      expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
      const sourceStillThere = await helpers.getPayeeById({
        id: source.id,
        raw: false,
      });
      expect(sourceStillThere.statusCode).toBe(200);
    });

    it("refuses to merge another user's payees", async () => {
      const foreignPayee = await createPayee({ name: 'Owned By First User' });

      const handle = await helpers.signUpSecondUser();
      await helpers.asUser({
        cookies: handle.cookies,
        fn: async () => {
          const ownPayee = await createPayee({ name: 'Owned By Second User' });

          const asSource = await helpers.bulkMergePayees({
            sourceIds: [foreignPayee.id],
            targetId: ownPayee.id,
            raw: false,
          });
          expect(asSource.statusCode).toBe(ERROR_CODES.NotFoundError);

          const asTarget = await helpers.bulkMergePayees({
            sourceIds: [ownPayee.id],
            targetId: foreignPayee.id,
            raw: false,
          });
          expect(asTarget.statusCode).toBe(ERROR_CODES.NotFoundError);
        },
      });

      const stillThere = await helpers.getPayeeById({
        id: foreignPayee.id,
        raw: false,
      });
      expect(stillThere.statusCode).toBe(200);
    });
  });
});
