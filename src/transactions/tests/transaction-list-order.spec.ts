import { SortOrder } from '../../common/enums/sort-order.enum';
import { TransactionListQuery } from '../types/transaction-list-query';
import { TransactionSortField } from '../types/transaction-sort-field.enum';
import { transactionListOrder } from '../utils/transaction-list-order';

const query = (
  sortBy: TransactionSortField,
  sortOrder: SortOrder = SortOrder.Desc,
): TransactionListQuery => ({ page: 1, limit: 20, sortBy, sortOrder });

describe('transactionListOrder', () => {
  it('orders by id alone when id is asked for', () => {
    expect(transactionListOrder(query(TransactionSortField.Id))).toEqual({
      id: 'DESC',
    });
  });

  it.each([
    [TransactionSortField.CreatedAt, 'createdAt'],
    [TransactionSortField.ResolvedAt, 'resolvedAt'],
    [TransactionSortField.AmountCrypto, 'amountCrypto'],
    [TransactionSortField.AmountFiat, 'amountFiat'],
  ])('orders by %s and breaks the tie on id', (sortBy, column) => {
    expect(transactionListOrder(query(sortBy, SortOrder.Asc))).toEqual({
      [column]: 'ASC',
      id: 'ASC',
    });
  });

  it('leaves only the id tiebreak for a merchant sort, whose name rank the service orders by in SQL', () => {
    expect(transactionListOrder(query(TransactionSortField.Merchant))).toEqual({
      id: 'DESC',
    });
  });
});
