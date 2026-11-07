import { toFiat } from '../../common/utils/to-fiat';
import { IsNull, LessThan, Not } from 'typeorm';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { MerchantApiRequest } from '../entities/merchant-api-request.entity';
import { MerchantRequestArchiveService } from '../services/merchant-request-archive.service';
import { MerchantRequestResult } from '../types/merchant-request-result.enum';

const config = (values: Record<string, unknown>) =>
  ({ get: (key: string) => values[key] }) as never;

const row = (n: number): MerchantApiRequest =>
  ({
    id: uuidOf(n),
    merchantId: uuidOf(100),
    apiKeyId: 3,
    method: 'GET',
    path: '/v1/merchant/balance',
    ip: '203.0.113.7',
    requestHeaders: { 'x-secure-key': 'abcd…wxyz' },
    requestBody: null,
    requestBodyTruncated: false,
    statusCode: 200,
    responseBody: '{"data":{}}',
    responseBodyTruncated: false,
    errorCode: null,
    durationMs: 5,
    result: MerchantRequestResult.Ok,
    transactionId: null,
    processedByUserId: null,
    selectionSummary: { candidates: 2 },
    receivedAt: new Date('2026-11-04T10:00:00Z'),
    archivedAt: null,
    createdAt: new Date('2026-11-04T10:00:01Z'),
    updatedAt: new Date('2026-11-04T10:00:01Z'),
  }) as unknown as MerchantApiRequest;

describe('MerchantRequestArchiveService', () => {
  let rows: MerchantApiRequest[];
  let builder: Record<string, jest.Mock>;
  let manager: { getRepository: jest.Mock; update: jest.Mock };
  let repo: { manager: { transaction: jest.Mock }; delete: jest.Mock };
  let victoria: { enabled: boolean; insertLines: jest.Mock };
  let service: MerchantRequestArchiveService;

  beforeEach(() => {
    rows = [row(1), row(2)];
    builder = {};
    for (const method of [
      'where',
      'orderBy',
      'addOrderBy',
      'limit',
      'setLock',
      'setOnLocked',
    ]) {
      builder[method] = jest.fn(() => builder);
    }
    builder.getMany = jest.fn(async () => rows);
    manager = {
      getRepository: jest.fn(() => ({ createQueryBuilder: () => builder })),
      update: jest.fn(async () => ({})),
    };
    repo = {
      manager: { transaction: jest.fn(async (work) => work(manager)) },
      delete: jest.fn(async () => ({ affected: 0 })),
    };
    victoria = { enabled: true, insertLines: jest.fn(async () => undefined) };
    service = new MerchantRequestArchiveService(
      repo as never,
      victoria as never,
      config({
        AUDIT_ARCHIVE_BATCH_SIZE: 2,
        AUDIT_ARCHIVE_INTERVAL_SECONDS: 300,
        MERCHANT_REQUEST_RETENTION_DAYS: 30,
      }),
    );
  });

  it('locks the oldest unarchived rows in receive order, skipping locked ones', async () => {
    await service.archiveBatch();

    expect(builder.where).toHaveBeenCalledWith('request.archivedAt IS NULL');
    expect(builder.orderBy).toHaveBeenCalledWith('request.receivedAt', 'ASC');
    expect(builder.addOrderBy).toHaveBeenCalledWith('request.id', 'ASC');
    expect(builder.limit).toHaveBeenCalledWith(2);
    expect(builder.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(builder.setOnLocked).toHaveBeenCalledWith('skip_locked');
  });

  it('ships every column as a merchant_api line, jsonb as JSON strings, then marks the rows', async () => {
    await expect(service.archiveBatch()).resolves.toBe(2);

    const [lines] = victoria.insertLines.mock.calls[0];
    expect(lines[0]).toMatchObject({
      source: 'merchant_api',
      message: 'GET /v1/merchant/balance',
      requestId: uuidOf(1),
      ip: '203.0.113.7',
      requestHeaders: '{"x-secure-key":"abcd…wxyz"}',
      selectionSummary: '{"candidates":2}',
      receivedAt: '2026-11-04T10:00:00.000Z',
      createdAt: '2026-11-04T10:00:01.000Z',
    });
    const [, where, changes] = manager.update.mock.calls[0];
    expect(where.id.value).toEqual([uuidOf(1), uuidOf(2)]);
    expect(changes.archivedAt()).toBe('now()');
  });

  it('keeps the descriptive columns on the line, the amount as a two-decimal string', async () => {
    rows = [
      {
        ...row(1),
        operation: 'pay_out_create',
        direction: 'pay_out',
        paymentMethod: 'sbp',
        amountFiat: toFiat('2000'),
        currency: 'RUB',
        requestedBankId: 7,
        payerUserId: 'payer-1',
        merchantTransactionId: 'order-1',
      } as unknown as MerchantApiRequest,
    ];

    await service.archiveBatch();

    const [lines] = victoria.insertLines.mock.calls[0];
    expect(lines[0]).toMatchObject({
      operation: 'pay_out_create',
      direction: 'pay_out',
      paymentMethod: 'sbp',
      amountFiat: '2000.00',
      currency: 'RUB',
      requestedBankId: 7,
      payerUserId: 'payer-1',
      merchantTransactionId: 'order-1',
    });
  });

  it('marks nothing when VictoriaLogs refuses', async () => {
    victoria.insertLines.mockRejectedValue(new Error('500'));

    await expect(service.archiveBatch()).rejects.toThrow('500');
    expect(manager.update).not.toHaveBeenCalled();
  });

  it('deletes only archived rows received before the retention window', async () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);

    await service.purgeArchived();

    expect(repo.delete).toHaveBeenCalledWith({
      archivedAt: Not(IsNull()),
      receivedAt: LessThan(new Date(now - 30 * 24 * 60 * 60 * 1000)),
    });
    jest.restoreAllMocks();
  });

  it('runs batches until one comes back short, then purges', async () => {
    builder.getMany.mockResolvedValueOnce(rows).mockResolvedValueOnce([row(3)]);

    await service.run();

    expect(victoria.insertLines).toHaveBeenCalledTimes(2);
    expect(repo.delete).toHaveBeenCalledTimes(1);
  });

  it('does nothing with archival off', async () => {
    victoria.enabled = false;

    await service.run();

    expect(repo.manager.transaction).not.toHaveBeenCalled();
  });
});
