import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { BankDetailsSortField } from '../../bank-details/types/bank-details-sort-field';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { TransactionType } from '../../common/enums/transaction-type.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { ListBankDetailsQueryDto } from '../dto/list-bank-details-query.dto';

const parse = (query: Record<string, unknown> = {}): ListBankDetailsQueryDto =>
  plainToInstance(ListBankDetailsQueryDto, query);

const failedProperties = (query: Record<string, unknown>): string[] =>
  validateSync(parse(query)).map((error) => error.property);

describe('ListBankDetailsQueryDto', () => {
  it('needs nothing and still describes a whole query', () => {
    expect(failedProperties({})).toEqual([]);
    expect(parse()).toEqual({
      page: 1,
      limit: 20,
      sortOrder: SortOrder.Desc,
      sortBy: BankDetailsSortField.CreatedAt,
    });
  });

  it('inherits the paging rules of the base query', () => {
    expect(failedProperties({ limit: '101' })).toEqual(['limit']);
    expect(failedProperties({ page: '0' })).toEqual(['page']);
  });

  it('filters by owner, and the owner must look like a uuid', () => {
    expect(failedProperties({ userId: uuidOf(1) })).toEqual([]);
    expect(failedProperties({ userId: '7' })).toEqual(['userId']);
  });

  it.each(Object.values(TransactionType))('filters by the type %s', (type) => {
    expect(failedProperties({ type })).toEqual([]);
  });

  describe('the boolean filters', () => {
    it.each([
      ['true', true],
      ['false', false],
    ])('reads %s from the query string as %s', (given, expected) => {
      expect(parse({ active: given }).active).toBe(expected);
      expect(parse({ banned: given }).banned).toBe(expected);
    });

    it('refuses anything that is not a boolean', () => {
      expect(failedProperties({ banned: 'yes' })).toEqual(['banned']);
    });

    it('leaves an absent filter absent rather than defaulting it', () => {
      expect(parse({}).banned).toBeUndefined();
      expect(parse({}).active).toBeUndefined();
    });
  });

  describe('sortBy', () => {
    it.each(Object.values(BankDetailsSortField))('sorts by %s', (sortBy) => {
      expect(failedProperties({ sortBy })).toEqual([]);
    });

    it.each([
      ['card', 'a value that would sort as text rather than as a number'],
      ['phone', 'the same, and not a column anyone orders by'],
      ['userId', 'a column outside the agreed set'],
    ])('refuses %s, being %s', (sortBy) => {
      expect(failedProperties({ sortBy })).toEqual(['sortBy']);
    });
  });
});
