import { SortOrder } from '../enums/sort-order.enum';
import { sortDirection } from '../utils/sort-direction';

describe('sortDirection', () => {
  it('turns the ascending order into the direction typeorm takes', () => {
    expect(sortDirection(SortOrder.Asc)).toBe('ASC');
  });

  it('turns the descending order into the direction typeorm takes', () => {
    expect(sortDirection(SortOrder.Desc)).toBe('DESC');
  });
});
