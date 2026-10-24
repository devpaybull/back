import { SortOrder } from '../../common/enums/sort-order.enum';
import { BankListQuery } from '../types/bank-list-query';
import { BankSortField } from '../types/bank-sort-field';
import { bankListOrder } from '../utils/bank-list-order';

const query = (
  sortBy: BankSortField,
  sortOrder = SortOrder.Desc,
): BankListQuery => ({ page: 1, limit: 20, sortBy, sortOrder });

describe('bankListOrder', () => {
  it('follows the requested direction', () => {
    expect(bankListOrder(query(BankSortField.Id, SortOrder.Asc))).toEqual({
      id: 'ASC',
    });
    expect(bankListOrder(query(BankSortField.Id))).toEqual({ id: 'DESC' });
  });

  it.each([
    [BankSortField.CreatedAt, 'createdAt'],
    [BankSortField.Name, 'name'],
    [BankSortField.BankId, 'bankId'],
  ])('breaks the tie of %s on id, so paging is stable', (sortBy, column) => {
    expect(bankListOrder(query(sortBy))).toEqual({
      [column]: 'DESC',
      id: 'DESC',
    });
  });

  it('covers every sort field the query may carry', () => {
    for (const sortBy of Object.values(BankSortField)) {
      expect(bankListOrder(query(sortBy))).toBeDefined();
    }
  });
});
