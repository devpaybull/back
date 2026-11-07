import { SortOrder } from '../../common/enums/sort-order.enum';
import { MobileOperatorListQuery } from '../types/mobile-operator-list-query';
import { MobileOperatorSortField } from '../types/mobile-operator-sort-field';
import { mobileOperatorListOrder } from '../utils/mobile-operator-list-order';

const query = (
  sortBy: MobileOperatorSortField,
  sortOrder = SortOrder.Desc,
): MobileOperatorListQuery => ({ page: 1, limit: 20, sortBy, sortOrder });

describe('mobileOperatorListOrder', () => {
  it('follows the requested direction', () => {
    expect(
      mobileOperatorListOrder(query(MobileOperatorSortField.Id, SortOrder.Asc)),
    ).toEqual({ id: 'ASC' });
    expect(mobileOperatorListOrder(query(MobileOperatorSortField.Id))).toEqual({
      id: 'DESC',
    });
  });

  it.each([
    [MobileOperatorSortField.CreatedAt, 'createdAt'],
    [MobileOperatorSortField.Name, 'name'],
    [MobileOperatorSortField.Code, 'code'],
  ])('breaks the tie of %s on id, so paging is stable', (sortBy, column) => {
    expect(mobileOperatorListOrder(query(sortBy))).toEqual({
      [column]: 'DESC',
      id: 'DESC',
    });
  });
});
