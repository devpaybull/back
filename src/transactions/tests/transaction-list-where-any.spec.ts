import { FindOperator, ILike, In } from 'typeorm';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { TransactionKind } from '../types/transaction-kind.enum';
import { TransactionSortField } from '../types/transaction-sort-field.enum';
import { transactionListWhereAny } from '../utils/transaction-list-where-any';

const base = {
  page: 1,
  limit: 20,
  sortBy: TransactionSortField.CreatedAt,
  sortOrder: SortOrder.Desc,
};

describe('transactionListWhereAny', () => {
  it('is one condition when nothing is searched', () => {
    expect(
      transactionListWhereAny({ ...base, kind: TransactionKind.PayIn }),
    ).toEqual([{ kind: TransactionKind.PayIn }]);
  });

  it('a number matches our id or the merchant’s order number, escaped', () => {
    const where = transactionListWhereAny({ ...base, search: 'a_1%' });

    expect(where).toHaveLength(2);
    expect(where[0].id).toBeInstanceOf(FindOperator);
    expect(where[1]).toEqual({ merchantTransactionId: ILike('%a\\_1\\%%') });
  });

  it('a requisite matches the pay-in’s requisites or the pay-out’s recipient', () => {
    const where = transactionListWhereAny({
      ...base,
      requisite: { bankDetailsIds: ['r1'], text: '4455' },
    });

    expect(where).toEqual([
      { bankDetailsId: In(['r1']) },
      { payoutCardNumber: ILike('%4455%') },
      { payoutPhone: ILike('%4455%') },
      { payoutOwnerName: ILike('%4455%') },
    ]);
  });

  it('no matching requisite still searches the recipients', () => {
    expect(
      transactionListWhereAny({
        ...base,
        requisite: { bankDetailsIds: [], text: 'Иван' },
      }),
    ).toHaveLength(3);
  });

  it('both searches multiply, every branch keeping the other filters', () => {
    const where = transactionListWhereAny({
      ...base,
      kind: TransactionKind.PayOut,
      search: 'abcd',
      requisite: { bankDetailsIds: ['r1'], text: '4455' },
    });

    expect(where).toHaveLength(8);
    expect(
      where.every((branch) => branch.kind === TransactionKind.PayOut),
    ).toBe(true);
  });

  it('a requisite search inside a bank keeps the bank: only requisites in both', () => {
    const where = transactionListWhereAny({
      ...base,
      bankDetailsIds: ['r1', 'r2'],
      requisite: { bankDetailsIds: ['r2', 'r3'], text: '4455' },
    });

    expect(where[0]).toEqual({ bankDetailsId: In(['r2']) });
    expect(where[1]).toEqual({
      bankDetailsId: In(['r1', 'r2']),
      payoutCardNumber: ILike('%4455%'),
    });
  });
});
