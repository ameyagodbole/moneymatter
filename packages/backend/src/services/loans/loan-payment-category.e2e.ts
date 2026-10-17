import { TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES, type RecordId } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';

const LOAN_INTERESTS_KEY = 'loan-interests';

const getLoanInterestsCategory = async () => {
  const categories = await helpers.getCategoriesList();
  const category = categories.find((c) => c.key === LOAN_INTERESTS_KEY);
  if (!category) throw new Error('Setup: expected a seeded loan-interests category');
  return category;
};

const getUserDefaultCategoryId = async () => {
  const user = await helpers.getUserInfo({ raw: true });
  return user.defaultCategoryId;
};

const createLoan = () =>
  helpers.createLoan({
    payload: helpers.buildCreateLoanPayload({
      initialBalance: 5_000,
      originalPrincipal: 5_000,
    }),
    raw: true,
  });

/** Pays `amount` into the loan straight from the transaction form: no category is sent for a transfer. */
const createLoanPayment = async ({
  loanId,
  accountId,
  amount,
}: {
  loanId: string;
  accountId: RecordId;
  amount: number;
}) => {
  const { categoryId: _categoryId, ...payload } = helpers.buildTransactionPayload({ accountId, amount });
  const [base, opposite] = await helpers.createTransaction({
    payload: {
      ...payload,
      transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
      destinationAmount: amount,
      destinationAccountId: loanId as RecordId,
    },
    raw: true,
  });
  return [base, opposite!].find((tx) => tx.accountId === accountId)!;
};

const createExpense = async ({ accountId, categoryId }: { accountId: RecordId; categoryId: RecordId }) => {
  const [tx] = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({
      accountId,
      amount: 300,
      categoryId,
      transactionType: TRANSACTION_TYPES.expense,
      transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
    }),
    raw: true,
  });
  return tx;
};

const getTransaction = async ({ id }: { id: string }) => {
  const txs = await helpers.getTransactions({ raw: true });
  return txs.find((tx) => tx.id === id)!;
};

describe('Loan payment category', () => {
  it('files a payment entered by hand under Loan interests so cash flow counts it', async () => {
    const loanInterests = await getLoanInterestsCategory();
    const loan = await createLoan();
    const source = await helpers.createAccount({ raw: true });

    const expenseLeg = await createLoanPayment({
      loanId: loan.id,
      accountId: source.id as RecordId,
      amount: 500,
    });

    expect(expenseLeg.categoryId).toBe(loanInterests.id);

    // Uncategorized legs are dropped by the category stats, which is how these payments used to vanish.
    const spendings = await helpers.getSpendingsByCategories({
      type: TRANSACTION_TYPES.expense,
      raw: true,
    });
    const rootId = (loanInterests.parentId ?? loanInterests.id) as RecordId;
    expect(spendings[rootId]?.amount).toBeGreaterThan(0);
  });

  it('moves an expense in the default category to Loan interests when it is linked as a payment', async () => {
    const loanInterests = await getLoanInterestsCategory();
    const defaultCategoryId = await getUserDefaultCategoryId();
    const loan = await createLoan();
    const source = await helpers.createAccount({ raw: true });
    const expense = await createExpense({
      accountId: source.id as RecordId,
      categoryId: defaultCategoryId,
    });

    await helpers.linkLoanPayments({
      id: loan.id,
      transactionIds: [expense.id],
      raw: true,
    });

    const linked = await getTransaction({ id: expense.id });
    expect(linked.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.transfer_to_loan);
    expect(linked.categoryId).toBe(loanInterests.id);
  });

  it('keeps a category the user chose when the expense is linked as a payment', async () => {
    const custom = await helpers.addCustomCategory({
      name: 'Car loan',
      color: '#123456',
      raw: true,
    });
    const loan = await createLoan();
    const source = await helpers.createAccount({ raw: true });
    const expense = await createExpense({
      accountId: source.id as RecordId,
      categoryId: custom.id as RecordId,
    });

    await helpers.linkLoanPayments({
      id: loan.id,
      transactionIds: [expense.id],
      raw: true,
    });

    const linked = await getTransaction({ id: expense.id });
    expect(linked.categoryId).toBe(custom.id);
  });

  it('falls back to the default category when Loan interests was deleted', async () => {
    const loanInterests = await getLoanInterestsCategory();
    const defaultCategoryId = await getUserDefaultCategoryId();
    await helpers.deleteCustomCategory({
      categoryId: loanInterests.id,
      raw: false,
    });
    const loan = await createLoan();
    const source = await helpers.createAccount({ raw: true });

    const expenseLeg = await createLoanPayment({
      loanId: loan.id,
      accountId: source.id as RecordId,
      amount: 500,
    });

    expect(expenseLeg.categoryId).toBe(defaultCategoryId);
  });
});
