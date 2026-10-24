import { SortOrder } from '../../common/enums/sort-order.enum';
import { BankDetailsListQuery } from '../types/bank-details-list-query';
import { BankDetailsSortField } from '../types/bank-details-sort-field';
import { bankDetailsListOrder } from '../utils/bank-details-list-order';

const query = (
  sortBy: BankDetailsSortField,
  sortOrder = SortOrder.Desc,
): BankDetailsListQuery => ({ page: 1, limit: 20, sortBy, sortOrder });

describe('bankDetailsListOrder', () => {
  it('follows the requested direction', () => {
    expect(
      bankDetailsListOrder(query(BankDetailsSortField.Id, SortOrder.Asc)),
    ).toEqual({ id: 'ASC' });
    expect(bankDetailsListOrder(query(BankDetailsSortField.Id))).toEqual({
      id: 'DESC',
    });
  });

  it.each([
    [BankDetailsSortField.CreatedAt, 'createdAt'],
    [BankDetailsSortField.MinAmount, 'minAmount'],
    [BankDetailsSortField.MaxAmount, 'maxAmount'],
    [BankDetailsSortField.DailyLimit, 'dailyLimit'],
  ])('breaks the tie of %s on id, so paging is stable', (sortBy, column) => {
    expect(bankDetailsListOrder(query(sortBy))).toEqual({
      [column]: 'DESC',
      id: 'DESC',
    });
  });

  it('orders the amounts by the numeric columns, not by card or phone', () => {
    const sortable = Object.values(BankDetailsSortField);

    expect(sortable).not.toContain('card');
    expect(sortable).not.toContain('phone');
  });

  it('covers every sort field the query may carry', () => {
    for (const sortBy of Object.values(BankDetailsSortField)) {
      expect(bankDetailsListOrder(query(sortBy))).toBeDefined();
    }
  });
});
