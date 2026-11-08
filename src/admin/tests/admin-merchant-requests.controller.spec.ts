import { NotFoundException } from '@nestjs/common';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { DayPeriod } from '../../common/enums/day-period.enum';
import { Role } from '../../common/enums/role.enum';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { Page } from '../../common/types/page';
import { AuthenticatedUser } from '../../common/types/token';
import { toFiat } from '../../common/utils/to-fiat';
import { MerchantRequestOperation } from '../../merchant-requests/types/merchant-request-operation.enum';
import { MerchantRequestRecord } from '../../merchant-requests/types/merchant-request-record';
import { MerchantRequestResult } from '../../merchant-requests/types/merchant-request-result.enum';
import { MerchantRequestSortField } from '../../merchant-requests/types/merchant-request-sort-field.enum';
import { TransactionKind } from '../../transactions/types/transaction-kind.enum';
import { AdminMerchantRequestsController } from '../controllers/admin-merchant-requests.controller';
import { ListMerchantRequestsQueryDto } from '../dto/list-merchant-requests-query.dto';
import { MerchantRequestFilterDto } from '../dto/merchant-request-filter.dto';
import { BALANCE_EXPORT_MAX_ROWS } from '../controllers/admin-balances.controller';

const MERCHANT = uuidOf(3);
const TRADER = uuidOf(4);
const RECEIVED = new Date('2026-11-05T08:25:54Z');
const admin = { id: uuidOf(8), role: Role.Admin } as AuthenticatedUser;
const superadmin = {
  id: uuidOf(9),
  role: Role.Superadmin,
} as AuthenticatedUser;

const record: MerchantRequestRecord = {
  id: uuidOf(1),
  merchantId: MERCHANT,
  statusCode: 201,
  errorCode: null,
  durationMs: 50,
  result: MerchantRequestResult.Created,
  operation: MerchantRequestOperation.PayInCreate,
  direction: TransactionKind.PayIn,
  paymentMethod: 'sbp',
  amountFiat: toFiat(2000),
  currency: 'RUB',
  requestedBankId: 7,
  payerUserId: '4214',
  merchantTransactionId: 'order-1',
  transactionId: uuidOf(50),
  processedByUserId: TRADER,
  counterpartyId: 42,
  receivedAt: RECEIVED,
  apiKeyId: 2,
  method: 'POST',
  path: '/v1/payment/pay-in',
  ip: '::ffff:203.0.113.7',
  requestHeaders: { 'x-secure-key': 'abcd…wxyz' },
  requestBody: '{\n  "amount": 2000\n}',
  requestBodyTruncated: false,
  responseBody: null,
  responseBodyTruncated: false,
  selectionSummary: {
    considered: 3,
    dropped: {},
    attempted: 1,
    skippedUnderLock: {},
    issuedBankDetailsId: uuidOf(60),
  },
};

const build = () => {
  const history = {
    list: jest.fn(
      async () =>
        new Page([record], { total: 1, page: 1, limit: 20, pages: 1 }),
    ),
    counters: jest.fn(async () => ({ all: 3, created: 2, notCreated: 1 })),
    export: jest.fn(async () => [record, { ...record, id: uuidOf(2) }]),
    findById: jest.fn(async (id: string) => (id === record.id ? record : null)),
  };
  const merchants = {
    findByIds: jest.fn(async () => [{ id: MERCHANT, name: 'Casino' }]),
    findIdsMatching: jest.fn(async () => [MERCHANT]),
    rankByName: jest.fn(async () => new Map([[MERCHANT, 0]])),
  };
  const banks = {
    findByIds: jest.fn(async () => [{ id: 7, code: 'tbank', name: 'Т-банк' }]),
  };
  const directory = {
    findByIds: jest.fn(async () => [
      { id: TRADER, telegramUsername: 'super_maks', email: null },
    ]),
  };

  return {
    history,
    merchants,
    banks,
    directory,
    controller: new AdminMerchantRequestsController(
      history as never,
      merchants as never,
      banks as never,
      directory as never,
      { getOrThrow: () => 'Europe/Moscow' } as never,
    ),
  };
};

const listQuery = (
  overrides: Partial<ListMerchantRequestsQueryDto> = {},
): ListMerchantRequestsQueryDto =>
  Object.assign(new ListMerchantRequestsQueryDto(), {
    page: 1,
    limit: 20,
    sortOrder: SortOrder.Desc,
    sortBy: MerchantRequestSortField.ReceivedAt,
    ...overrides,
  });

describe('AdminMerchantRequestsController', () => {
  const proto = AdminMerchantRequestsController.prototype;

  it('is open to admin and superadmin and writes nothing', () => {
    expect(
      Reflect.getMetadata(ROLES_METADATA_KEY, AdminMerchantRequestsController),
    ).toEqual([Role.Admin, Role.Superadmin]);

    for (const handler of [
      proto.list,
      proto.counters,
      proto.export,
      proto.findOne,
    ]) {
      expect(Reflect.getMetadata(WRITE_ACCESS_METADATA_KEY, handler)).toBe(
        undefined,
      );
      expect(Reflect.getMetadata(ROLES_METADATA_KEY, handler)).toBe(undefined);
    }
  });

  it('lists rows with the merchant, the requested bank and the trader that took the deal', async () => {
    const { controller } = build();

    const page = await controller.list(listQuery());

    expect(page.items).toEqual([
      {
        id: uuidOf(1),
        receivedAt: RECEIVED,
        merchant: { id: MERCHANT, name: 'Casino' },
        operation: 'pay_in_create',
        direction: 'pay_in',
        method: 'sbp',
        amount: '2000.00',
        currency: 'RUB',
        bank: { id: 7, code: 'tbank', name: 'Т-банк' },
        payerUserId: '4214',
        counterpartyId: 42,
        merchantTransactionId: 'order-1',
        result: 'created',
        statusCode: 201,
        errorCode: null,
        processedBy: { id: TRADER, login: 'super_maks' },
        durationMs: 50,
        transactionId: uuidOf(50),
      },
    ]);
    expect(page.meta.total).toBe(1);
  });

  it('defaults the period to all time, up to midnight after today in the business timezone', async () => {
    const { controller, history, merchants } = build();

    await controller.list(listQuery());

    const [sent] = history.list.mock.calls[0] as unknown as [
      Record<string, unknown>,
    ];

    expect(sent.receivedFrom).toBeNull();
    expect(sent.receivedBefore).toBeInstanceOf(Date);
    expect(sent.merchantRanks).toBeUndefined();
    expect(merchants.findIdsMatching).not.toHaveBeenCalled();
  });

  it('turns the filters into the service’s terms: days in the business timezone, fiat, «any» bank, merchants by name', async () => {
    const { controller, history, merchants } = build();

    await controller.list(
      listQuery({
        periodFrom: '2026-11-01',
        periodTo: '2026-11-02',
        amountFrom: '100',
        amountTo: '2000.50',
        bankId: 'any',
        method: 'sbp',
        direction: TransactionKind.PayIn,
        operation: [MerchantRequestOperation.PayInCreate],
        result: MerchantRequestResult.NotCreated,
        merchantId: MERCHANT,
        search: 'Casino',
        sortBy: MerchantRequestSortField.Merchant,
      }),
    );

    const [sent] = history.list.mock.calls[0] as unknown as [
      Record<string, unknown>,
    ];

    expect(sent).toMatchObject({
      receivedFrom: new Date('2026-10-31T21:00:00.000Z'),
      receivedBefore: new Date('2026-11-02T21:00:00.000Z'),
      requestedBankId: null,
      paymentMethod: 'sbp',
      direction: 'pay_in',
      operations: ['pay_in_create'],
      result: 'not_created',
      merchantId: MERCHANT,
      search: 'Casino',
      searchMerchantIds: [MERCHANT],
      merchantRanks: new Map([[MERCHANT, 0]]),
      sortBy: 'merchant',
    });
    expect(String(sent.amountFrom)).toBe('100');
    expect(String(sent.amountTo)).toBe('2000.5');
    expect(merchants.findIdsMatching).toHaveBeenCalledWith('Casino');
  });

  it('passes a bank id as a number', async () => {
    const { controller, history } = build();

    await controller.list(listQuery({ bankId: 7, period: DayPeriod.Today }));

    expect(history.list.mock.calls[0]).toEqual([
      expect.objectContaining({ requestedBankId: 7 }),
    ]);
  });

  it('counts the tabs under the same filters', async () => {
    const { controller, history } = build();

    expect(
      await controller.counters(
        Object.assign(new MerchantRequestFilterDto(), { merchantId: MERCHANT }),
      ),
    ).toEqual({ all: 3, created: 2, notCreated: 1 });
    expect(history.counters).toHaveBeenCalledWith(
      expect.objectContaining({ merchantId: MERCHANT, receivedFrom: null }),
    );
  });

  it('exports CSV with the export cap', async () => {
    const { controller, history } = build();

    const file = await controller.export(new MerchantRequestFilterDto());
    const csv = await new Promise<string>((resolve) => {
      const chunks: Buffer[] = [];
      file
        .getStream()
        .on('data', (chunk: Buffer) => chunks.push(chunk))
        .on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    });

    expect(history.export).toHaveBeenCalledWith(
      expect.any(Object),
      BALANCE_EXPORT_MAX_ROWS,
    );
    expect(file.getHeaders()).toMatchObject({
      type: 'text/csv; charset=utf-8',
      disposition: 'attachment; filename="merchant-requests.csv"',
    });
    expect(csv.split('\r\n')).toHaveLength(4);
  });

  it('shows the card with headers, bodies, sizes and the whole address to a superadmin', async () => {
    const { controller } = build();

    const card = await controller.findOne(uuidOf(1), superadmin);

    expect(card).toMatchObject({
      id: uuidOf(1),
      counterpartyId: 42,
      httpMethod: 'POST',
      path: '/v1/payment/pay-in',
      ip: '::ffff:203.0.113.7',
      requestHeaders: { 'x-secure-key': 'abcd…wxyz' },
      requestBody: '{\n  "amount": 2000\n}',
      responseBody: null,
      selectionSummary: { considered: 3, attempted: 1 },
      sizes: {
        headers: { sizeBytes: 35, lines: 3 },
        body: { sizeBytes: 20, lines: 3 },
        response: { sizeBytes: 0, lines: 0 },
      },
    });
  });

  it('masks the client address for an admin', async () => {
    const { controller, history } = build();

    expect((await controller.findOne(uuidOf(1), admin)).ip).toBe('203.0.*.*');

    history.findById.mockResolvedValueOnce({ ...record, ip: null });
    expect((await controller.findOne(uuidOf(1), admin)).ip).toBeNull();
  });

  describe('the address headers of the card', () => {
    const headers = {
      'X-Forwarded-For': '203.0.113.7, ::ffff:198.51.100.2 ,2001:db8::1',
      'x-real-ip': ' 203.0.113.8 ',
      FORWARDED:
        'for=192.0.2.60;proto=http;by=203.0.113.43, for="[2001:db8:cafe::17]:4711", For=unknown, for="198.51.100.9:8080"',
      'x-secure-key': 'abcd…wxyz',
      'user-agent': 'probe 1.2.3.4',
    };

    it('masks every address of X-Forwarded-For, X-Real-IP and Forwarded for= for an admin, whatever the case of the name', async () => {
      const { controller, history } = build();
      const stored = { ...record, requestHeaders: { ...headers } };
      history.findById.mockResolvedValueOnce(stored);

      const card = await controller.findOne(uuidOf(1), admin);

      expect(card.requestHeaders).toEqual({
        'X-Forwarded-For': '203.0.*.*, 198.51.*.*, 2001:db8:0:0:*:*:*:*',
        'x-real-ip': '203.0.*.*',
        FORWARDED:
          'for=192.0.*.*;proto=http;by=203.0.113.43, for="[2001:db8:cafe:0:*:*:*:*]:4711", For=*, for="198.51.*.*:8080"',
        'x-secure-key': 'abcd…wxyz',
        'user-agent': 'probe 1.2.3.4',
      });
      expect(stored.requestHeaders).toEqual(headers);
      expect(card.sizes.headers.sizeBytes).toBe(
        Buffer.byteLength(JSON.stringify(card.requestHeaders, null, 2)),
      );
    });

    it('shows them as stored to a superadmin', async () => {
      const { controller, history } = build();
      history.findById.mockResolvedValueOnce({
        ...record,
        requestHeaders: { ...headers },
      });

      const card = await controller.findOne(uuidOf(1), superadmin);

      expect(card.requestHeaders).toEqual(headers);
    });
  });

  it('answers 404 for a request found nowhere', async () => {
    const { controller } = build();

    await expect(controller.findOne(uuidOf(2), admin)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
