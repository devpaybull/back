import { FindOperator } from 'typeorm';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { CounterpartySortField } from '../types/counterparty-sort-field.enum';
import { counterpartyListWhere } from '../utils/counterparty-list-where';

const query = (overrides: Record<string, unknown> = {}) => ({
  page: 1,
  limit: 20,
  sortBy: CounterpartySortField.CreatedAt,
  sortOrder: SortOrder.Desc,
  ...overrides,
});

describe('counterpartyListWhere', () => {
  it('filters by merchant id with no search', () => {
    expect(counterpartyListWhere(query({ merchantId: 'm1' }) as never)).toEqual(
      {
        merchantId: 'm1',
      },
    );
  });

  it('returns an empty filter with no merchant and no search', () => {
    expect(counterpartyListWhere(query() as never)).toEqual({});
  });

  it('searches externalId and name, keeping the merchant filter on both', () => {
    const where = counterpartyListWhere(
      query({ merchantId: 'm1', search: 'ivan' }) as never,
    ) as Array<{ merchantId: string; externalId?: unknown; name?: unknown }>;

    expect(where).toHaveLength(2);
    expect(where[0].merchantId).toBe('m1');
    expect(where[1].merchantId).toBe('m1');
    expect(where[0].externalId).toBeInstanceOf(FindOperator);
    expect(where[1].name).toBeInstanceOf(FindOperator);
  });
});
