import { FindOperator } from 'typeorm';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { MobileOperatorListQuery } from '../types/mobile-operator-list-query';
import { MobileOperatorSortField } from '../types/mobile-operator-sort-field';
import { mobileOperatorListWhere } from '../utils/mobile-operator-list-where';

const query = (
  overrides: Partial<MobileOperatorListQuery> = {},
): MobileOperatorListQuery => ({
  page: 1,
  limit: 20,
  sortBy: MobileOperatorSortField.CreatedAt,
  sortOrder: SortOrder.Desc,
  ...overrides,
});

describe('mobileOperatorListWhere', () => {
  it('asks for everything when nothing was filtered', () => {
    expect(mobileOperatorListWhere(query())).toEqual({});
  });

  it('keeps a false filter, which is not the same as an absent one', () => {
    expect(mobileOperatorListWhere(query({ active: false }))).toEqual({
      active: false,
    });
  });

  it('filters by country', () => {
    expect(mobileOperatorListWhere(query({ countryId: 2 }))).toEqual({
      countryId: 2,
    });
  });

  it('searches over code and name, each branch keeping the filters', () => {
    const where = mobileOperatorListWhere(
      query({ search: 'mts', countryId: 1 }),
    );

    expect(Array.isArray(where)).toBe(true);
    expect(
      (where as Record<string, unknown>[]).map((branch) =>
        Object.keys(branch).sort(),
      ),
    ).toEqual([
      ['code', 'countryId'],
      ['countryId', 'name'],
    ]);
  });

  it('escapes the wildcards of the search term', () => {
    const [branch] = mobileOperatorListWhere(query({ search: '5%_' })) as {
      code: FindOperator<string>;
    }[];

    expect(branch.code.value).toBe('%5\\%\\_%');
  });
});
