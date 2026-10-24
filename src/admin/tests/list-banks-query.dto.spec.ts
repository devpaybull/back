import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { BankSortField } from '../../banks/types/bank-sort-field';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { TransactionType } from '../../common/enums/transaction-type.enum';
import { ListBanksQueryDto } from '../dto/list-banks-query.dto';

const parse = (query: Record<string, unknown> = {}): ListBanksQueryDto =>
  plainToInstance(ListBanksQueryDto, query);

const failedProperties = (query: Record<string, unknown>): string[] =>
  validateSync(parse(query)).map((error) => error.property);

describe('ListBanksQueryDto', () => {
  it('needs nothing and still describes a whole query', () => {
    expect(failedProperties({})).toEqual([]);
    expect(parse()).toEqual({
      page: 1,
      limit: 20,
      sortOrder: SortOrder.Desc,
      sortBy: BankSortField.CreatedAt,
    });
  });

  it('inherits the paging rules of the base query', () => {
    expect(failedProperties({ limit: '101' })).toEqual(['limit']);
    expect(failedProperties({ page: '0' })).toEqual(['page']);
  });

  describe('the boolean filters', () => {
    it.each([
      ['true', true],
      ['false', false],
    ])('reads %s from the query string as %s', (given, expected) => {
      expect(failedProperties({ active: given })).toEqual([]);
      expect(parse({ active: given }).active).toBe(expected);
      expect(parse({ automatic: given }).automatic).toBe(expected);
    });

    it('refuses anything that is not a boolean', () => {
      expect(failedProperties({ active: 'yes' })).toEqual(['active']);
    });

    it('leaves an absent filter absent rather than defaulting it to false', () => {
      expect(parse({}).active).toBeUndefined();
    });
  });

  describe('the reference filters', () => {
    it('takes numeric ids from the query string', () => {
      expect(failedProperties({ countryId: '2', currencyId: '3' })).toEqual([]);
      expect(parse({ countryId: '2' }).countryId).toBe(2);
    });

    it('refuses an id that is not a positive integer', () => {
      expect(failedProperties({ countryId: '0' })).toEqual(['countryId']);
      expect(failedProperties({ currencyId: 'kaspi' })).toEqual(['currencyId']);
    });

    it.each(Object.values(TransactionType))(
      'accepts the transaction type %s',
      (transactionType) => {
        expect(failedProperties({ transactionType })).toEqual([]);
      },
    );

    it('refuses a transaction type outside the enum', () => {
      expect(failedProperties({ transactionType: 'p2p' })).toEqual([
        'transactionType',
      ]);
    });
  });

  describe('sortBy', () => {
    it.each(Object.values(BankSortField))('sorts by %s', (sortBy) => {
      expect(failedProperties({ sortBy })).toEqual([]);
      expect(parse({ sortBy }).sortBy).toBe(sortBy);
    });

    it.each(['active', 'currencyId', 'code'])(
      'refuses %s, a column outside the agreed set',
      (sortBy) => {
        expect(failedProperties({ sortBy })).toEqual(['sortBy']);
      },
    );
  });
});
