import { FindOperator, FindOptionsWhere } from 'typeorm';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { TransactionType } from '../../common/enums/transaction-type.enum';
import { Bank } from '../entities/bank.entity';
import { BankListQuery } from '../types/bank-list-query';
import { BankSortField } from '../types/bank-sort-field';
import { bankListWhere } from '../utils/bank-list-where';

const query = (overrides: Partial<BankListQuery> = {}): BankListQuery => ({
  page: 1,
  limit: 20,
  sortBy: BankSortField.CreatedAt,
  sortOrder: SortOrder.Desc,
  ...overrides,
});

const branches = (
  where: FindOptionsWhere<Bank> | FindOptionsWhere<Bank>[],
): FindOptionsWhere<Bank>[] => (Array.isArray(where) ? where : [where]);

describe('bankListWhere', () => {
  it('asks for everything when nothing was filtered', () => {
    expect(bankListWhere(query())).toEqual({});
  });

  it('keeps a false filter, which is not the same as an absent one', () => {
    expect(bankListWhere(query({ active: false }))).toEqual({ active: false });
    expect(bankListWhere(query({ automatic: false }))).toEqual({
      automatic: false,
    });
  });

  it('filters by country and currency', () => {
    expect(bankListWhere(query({ countryId: 2, currencyId: 3 }))).toEqual({
      countryId: 2,
      currencyId: 3,
    });
  });

  it('asks whether the array contains the transaction type', () => {
    const where = bankListWhere(
      query({ transactionType: TransactionType.Sbp }),
    ) as FindOptionsWhere<Bank>;
    const condition = where.transactionTypes as unknown as FindOperator<
      TransactionType[]
    >;

    expect(condition).toBeInstanceOf(FindOperator);
    expect(condition.type).toBe('arrayContains');
    expect(condition.value).toEqual([TransactionType.Sbp]);
  });

  describe('search', () => {
    it('looks in bankId, name and code, one branch each', () => {
      const found = branches(bankListWhere(query({ search: 'kaspi' })));

      expect(found).toHaveLength(3);
      expect(found.map((branch) => Object.keys(branch)[0])).toEqual([
        'bankId',
        'name',
        'code',
      ]);
    });

    it('escapes the wildcards so a search for 100% is not every row', () => {
      const [first] = branches(bankListWhere(query({ search: '100%_x' })));
      const condition = first.bankId as unknown as FindOperator<string>;

      expect(condition.type).toBe('ilike');
      expect(condition.value).toBe('%100\\%\\_x%');
    });

    it('carries the filters into every branch of the search', () => {
      const found = branches(
        bankListWhere(query({ search: 'kaspi', active: true, countryId: 2 })),
      );

      for (const branch of found) {
        expect(branch).toMatchObject({ active: true, countryId: 2 });
      }
    });
  });
});
