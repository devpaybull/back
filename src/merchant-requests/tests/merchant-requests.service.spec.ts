import { uuidOf } from '../../common/tests/uuid-of.spec';
import { toFiat } from '../../common/utils/to-fiat';
import { TransactionKind } from '../../transactions/types/transaction-kind.enum';
import { MerchantRequestsService } from '../services/merchant-requests.service';
import { MerchantRequestEntry } from '../types/merchant-request-entry';
import { MerchantRequestOperation } from '../types/merchant-request-operation.enum';
import { MerchantRequestResult } from '../types/merchant-request-result.enum';

const build = (maxBytes = 65536) => {
  const requests = { insert: jest.fn(async () => undefined) };
  const config = { get: jest.fn(() => maxBytes) };

  return {
    requests,
    service: new MerchantRequestsService(requests as never, config as never),
  };
};

const entry = (
  overrides: Partial<MerchantRequestEntry> = {},
): MerchantRequestEntry => ({
  id: uuidOf(7),
  merchantId: uuidOf(1),
  apiKeyId: 2,
  method: 'GET',
  path: '/v1/merchant/balance',
  ip: '203.0.113.7',
  requestHeaders: {},
  requestBody: null,
  statusCode: 200,
  responseBody: '{"data":{}}',
  durationMs: 12,
  receivedAt: new Date('2026-11-04T10:00:00Z'),
  ...overrides,
});

const inserted = (requests: { insert: jest.Mock }) =>
  requests.insert.mock.calls[0][0] as Record<string, unknown>;

describe('MerchantRequestsService.record', () => {
  it.each(['203.0.113.7', '2001:db8::1', null])(
    'stores the address %s as it came, unmasked',
    async (ip) => {
      const { service, requests } = build();

      await service.record(entry({ ip }));

      expect(inserted(requests).ip).toBe(ip);
    },
  );

  it('masks the key to its first and last four characters and drops Authorization and Cookie', async () => {
    const { service, requests } = build();

    await service.record(
      entry({
        requestHeaders: {
          'X-Secure-Key': '0123abcd-ef00-4000-8000-00000000wxyz',
          authorization: 'Bearer t',
          cookie: 'refresh=1',
          accept: ['a', 'b'],
          'x-empty': undefined,
        },
      }),
    );

    expect(inserted(requests).requestHeaders).toEqual({
      'x-secure-key': '0123…wxyz',
      accept: 'a, b',
    });
  });

  it('hides a key too short to mask entirely', async () => {
    const { service, requests } = build();

    await service.record(
      entry({ requestHeaders: { 'x-secure-key': 'short' } }),
    );

    expect(inserted(requests).requestHeaders).toEqual({ 'x-secure-key': '…' });
  });

  it('writes a success as ok, under the given id, without an error code', async () => {
    const { service, requests } = build();

    await service.record(entry());

    expect(inserted(requests)).toMatchObject({
      id: uuidOf(7),
      merchantId: uuidOf(1),
      apiKeyId: 2,
      statusCode: 200,
      result: MerchantRequestResult.Ok,
      errorCode: null,
      responseBody: '{"data":{}}',
      responseBodyTruncated: false,
      requestBody: null,
      durationMs: 12,
    });
  });

  it('writes a failure as error with the catalog code of the body', async () => {
    const { service, requests } = build();

    await service.record(
      entry({
        statusCode: 403,
        responseBody:
          '{"statusCode":403,"code":"IP_NOT_ALLOWED","message":"x"}',
      }),
    );

    expect(inserted(requests)).toMatchObject({
      result: MerchantRequestResult.Error,
      errorCode: 'IP_NOT_ALLOWED',
    });
  });

  it('leaves the code empty for a failure whose body is not JSON', async () => {
    const { service, requests } = build();

    await service.record(entry({ statusCode: 500, responseBody: 'oops' }));

    expect(inserted(requests).errorCode).toBeNull();
  });

  it('cuts a body longer than the limit in bytes and flags it', async () => {
    const { service, requests } = build(4);

    await service.record(entry({ requestBody: 'abcdef', responseBody: 'ab' }));

    expect(inserted(requests)).toMatchObject({
      requestBody: 'abcd',
      requestBodyTruncated: true,
      responseBody: 'ab',
      responseBodyTruncated: false,
    });
  });
});

describe('MerchantRequestsService.record — a create request', () => {
  const details = {
    operation: MerchantRequestOperation.PayInCreate,
    direction: TransactionKind.PayIn,
    paymentMethod: 'sbp',
    amountFiat: toFiat(2000),
    currency: 'RUB',
    requestedBankId: 7,
    payerUserId: 'client-1',
    merchantTransactionId: 'order-1',
  };

  it('is `created` with the deal, the trader and the summary when a deal is answered', async () => {
    const { service, requests } = build();
    const summary = {
      considered: 1,
      dropped: {},
      attempted: 1,
      skippedUnderLock: {},
      issuedBankDetailsId: uuidOf(4),
    };

    await service.record(
      entry({
        method: 'POST',
        statusCode: 201,
        details: {
          ...details,
          transactionId: uuidOf(3),
          processedByUserId: uuidOf(2),
          selectionSummary: summary,
        },
      }),
    );

    expect(inserted(requests)).toMatchObject({
      result: MerchantRequestResult.Created,
      operation: 'pay_in_create',
      direction: 'pay_in',
      paymentMethod: 'sbp',
      amountFiat: toFiat(2000),
      currency: 'RUB',
      requestedBankId: 7,
      payerUserId: 'client-1',
      merchantTransactionId: 'order-1',
      transactionId: uuidOf(3),
      processedByUserId: uuidOf(2),
      selectionSummary: summary,
    });
  });

  it('is `created` for a 200 repeat that answers an existing deal too', async () => {
    const { service, requests } = build();

    await service.record(entry({ statusCode: 200, details }));

    expect(inserted(requests).result).toBe(MerchantRequestResult.Created);
  });

  it('is `not_created` with the error code on a refusal', async () => {
    const { service, requests } = build();

    await service.record(
      entry({
        statusCode: 403,
        responseBody: '{"code":"NO_REQUISITE_FOUND_FOR_THIS_AMOUNT"}',
        details,
      }),
    );

    expect(inserted(requests)).toMatchObject({
      result: MerchantRequestResult.NotCreated,
      errorCode: 'NO_REQUISITE_FOUND_FOR_THIS_AMOUNT',
      transactionId: null,
      processedByUserId: null,
    });
  });

  it('leaves the descriptive columns null for a request that is not a create', async () => {
    const { service, requests } = build();

    await service.record(entry());

    expect(inserted(requests)).toMatchObject({
      result: MerchantRequestResult.Ok,
      operation: null,
      paymentMethod: null,
      amountFiat: null,
      merchantTransactionId: null,
    });
  });
});
