import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { TRANSACTION_METHOD_CODES } from '../../transactions/utils/transaction-methods';
import { ListTransactionsQueryDto } from '../dto/list-transactions-query.dto';

const failedProperties = (query: Record<string, unknown>): string[] =>
  validateSync(plainToInstance(ListTransactionsQueryDto, query)).map(
    (error) => error.property,
  );

describe('ListTransactionsQueryDto', () => {
  it('needs no method filter', () => {
    expect(failedProperties({})).toEqual([]);
  });

  it.each(TRANSACTION_METHOD_CODES)('filters by the method %s', (method) => {
    expect(failedProperties({ method })).toEqual([]);
  });

  it('refuses a method the registry does not know', () => {
    expect(failedProperties({ method: 'qr' })).toEqual(['method']);
  });
});

describe('ListTransactionsQueryDto — the deals tab filters', () => {
  const parsed = (query: Record<string, unknown>): ListTransactionsQueryDto =>
    plainToInstance(ListTransactionsQueryDto, query);

  it('reads the period bounds as dates', () => {
    const query = parsed({
      createdFrom: '2026-10-01T00:00:00.000Z',
      createdTo: '2026-10-31T23:59:59.999Z',
    });

    expect(
      failedProperties({
        createdFrom: '2026-10-01T00:00:00.000Z',
        createdTo: '2026-10-31T23:59:59.999Z',
      }),
    ).toEqual([]);
    expect(query.createdFrom).toEqual(new Date('2026-10-01T00:00:00.000Z'));
    expect(query.createdTo).toEqual(new Date('2026-10-31T23:59:59.999Z'));
  });

  it('accepts either bound of the period on its own', () => {
    expect(failedProperties({ createdFrom: '2026-10-01' })).toEqual([]);
    expect(failedProperties({ createdTo: '2026-10-01' })).toEqual([]);
  });

  it('refuses a period bound that is not a date', () => {
    expect(failedProperties({ createdFrom: 'yesterday' })).toEqual([
      'createdFrom',
    ]);
    expect(failedProperties({ createdTo: 'soon' })).toEqual(['createdTo']);
  });

  it('refuses a period that ends before it starts', () => {
    expect(
      failedProperties({
        createdFrom: '2026-10-02T00:00:00.000Z',
        createdTo: '2026-10-01T00:00:00.000Z',
      }),
    ).toEqual(['createdTo']);
  });

  it('accepts a period that starts and ends at the same instant', () => {
    expect(
      failedProperties({
        createdFrom: '2026-10-01T00:00:00.000Z',
        createdTo: '2026-10-01T00:00:00.000Z',
      }),
    ).toEqual([]);
  });

  it('reads the amount bounds as numbers, decimals included', () => {
    const query = parsed({ amountFrom: '1000', amountTo: '2500.5' });

    expect(
      failedProperties({ amountFrom: '1000', amountTo: '2500.5' }),
    ).toEqual([]);
    expect(query.amountFrom).toBe(1000);
    expect(query.amountTo).toBe(2500.5);
  });

  it('refuses an amount range whose lower bound is above the upper one', () => {
    expect(failedProperties({ amountFrom: '5000', amountTo: '100' })).toEqual([
      'amountTo',
    ]);
  });

  it('accepts an amount range of a single value', () => {
    expect(failedProperties({ amountFrom: '100', amountTo: '100' })).toEqual(
      [],
    );
  });

  it.each([['-1'], ['abc'], ['']])('refuses %p as an amount bound', (value) => {
    expect(failedProperties({ amountFrom: value })).toEqual(['amountFrom']);
    expect(failedProperties({ amountTo: value })).toEqual(['amountTo']);
  });

  it('reads the bank as an integer id', () => {
    expect(parsed({ bankId: '7' }).bankId).toBe(7);
    expect(failedProperties({ bankId: '7' })).toEqual([]);
  });

  it.each([['0'], ['1.5'], ['bank']])('refuses %p as a bank id', (value) => {
    expect(failedProperties({ bankId: value })).toEqual(['bankId']);
  });

  it.each([['amountFiat'], ['merchant'], ['createdAt'], ['id']])(
    'sorts by %s',
    (sortBy) => {
      expect(failedProperties({ sortBy })).toEqual([]);
    },
  );

  it('refuses a sort field outside the closed set', () => {
    expect(failedProperties({ sortBy: 'merchantName' })).toEqual(['sortBy']);
  });

  it('still refuses a page larger than 100 rows', () => {
    expect(failedProperties({ limit: '101' })).toEqual(['limit']);
  });
});
