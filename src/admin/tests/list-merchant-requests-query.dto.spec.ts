import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ListMerchantRequestsQueryDto } from '../dto/list-merchant-requests-query.dto';
import { MerchantRequestFilterDto } from '../dto/merchant-request-filter.dto';

const parsed = (query: Record<string, unknown>) =>
  plainToInstance(ListMerchantRequestsQueryDto, query);

const failedProperties = (query: Record<string, unknown>): string[] =>
  validateSync(parsed(query)).map((error) => error.property);

describe('ListMerchantRequestsQueryDto', () => {
  it('needs nothing and sorts by receivedAt by default', () => {
    expect(failedProperties({})).toEqual([]);
    expect(parsed({}).sortBy).toBe('receivedAt');
  });

  it.each(['receivedAt', 'merchant', 'amount', 'payerUserId'])(
    'sorts by %s',
    (sortBy) => {
      expect(failedProperties({ sortBy })).toEqual([]);
    },
  );

  it('refuses a column that is not sortable', () => {
    expect(failedProperties({ sortBy: 'path' })).toEqual(['sortBy']);
  });

  it('refuses a limit over 100', () => {
    expect(failedProperties({ limit: '101' })).toEqual(['limit']);
  });

  it('takes the two tab results only', () => {
    expect(failedProperties({ result: 'created' })).toEqual([]);
    expect(failedProperties({ result: 'not_created' })).toEqual([]);
    expect(failedProperties({ result: 'ok' })).toEqual(['result']);
  });

  it('reads bankId as a bank id or «any»', () => {
    expect(parsed({ bankId: '7' }).bankId).toBe(7);
    expect(parsed({ bankId: 'any' }).bankId).toBe('any');
    expect(failedProperties({ bankId: '7' })).toEqual([]);
    expect(failedProperties({ bankId: 'any' })).toEqual([]);
    expect(failedProperties({ bankId: '0' })).toEqual(['bankId']);
    expect(failedProperties({ bankId: 'all' })).toEqual(['bankId']);
    expect(failedProperties({ bankId: '2147483648' })).toEqual(['bankId']);
  });

  it('takes operations as a list, repeated or comma-separated', () => {
    expect(
      parsed({ operation: 'pay_in_create,pay_out_create' }).operation,
    ).toEqual(['pay_in_create', 'pay_out_create']);
    expect(failedProperties({ operation: ['pay_in_create'] })).toEqual([]);
    expect(failedProperties({ operation: 'cancel' })).toEqual(['operation']);
  });

  it('validates the method, the direction and the merchant', () => {
    expect(
      failedProperties({
        method: 'sbp',
        direction: 'pay_out',
        merchantId: '00000000-0000-4000-8000-000000000001',
      }),
    ).toEqual([]);
    expect(failedProperties({ method: 'qr' })).toEqual(['method']);
    expect(failedProperties({ direction: 'sideways' })).toEqual(['direction']);
    expect(failedProperties({ merchantId: 'casino' })).toEqual(['merchantId']);
  });

  it('takes amounts as fiat strings and refuses a range upside down', () => {
    expect(
      failedProperties({ amountFrom: '100', amountTo: '2000.50' }),
    ).toEqual([]);
    expect(failedProperties({ amountFrom: '1.005' })).toEqual(['amountFrom']);
    expect(failedProperties({ amountFrom: '200', amountTo: '100' })).toEqual([
      'amountTo',
    ]);
  });

  it('takes a period preset or two calendar days', () => {
    expect(failedProperties({ period: 'all_time' })).toEqual([]);
    expect(
      failedProperties({ periodFrom: '2026-11-01', periodTo: '2026-11-02' }),
    ).toEqual([]);
    expect(failedProperties({ period: 'forever' })).toEqual(['period']);
    expect(
      failedProperties({ periodFrom: '2026-11-02', periodTo: '2026-11-01' }),
    ).toEqual(['periodTo']);
    expect(failedProperties({ periodFrom: '2026-11-01T00:00Z' })).toEqual([
      'periodFrom',
    ]);
  });

  it('trims the search and allows a whole merchantTransactionId', () => {
    expect(parsed({ search: '  order-1 ' }).search).toBe('order-1');
    expect(failedProperties({ search: 'x'.repeat(255) })).toEqual([]);
    expect(failedProperties({ search: 'x'.repeat(256) })).toEqual(['search']);
  });
});

describe('MerchantRequestFilterDto', () => {
  it('takes the filters without paging', () => {
    expect(
      validateSync(
        plainToInstance(MerchantRequestFilterDto, {
          result: 'created',
          bankId: 'any',
        }),
      ),
    ).toEqual([]);
  });
});
