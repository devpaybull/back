import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FindOperator } from 'typeorm';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { MerchantDealsService } from '../services/merchant-deals.service';
import { TransactionSortField } from '../types/transaction-sort-field.enum';
import { TransactionStatus } from '../types/transaction-status.enum';

const MERCHANT = uuidOf(30);

describe('MerchantDealsService', () => {
  const build = () => {
    const builder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      setFindOptions: jest.fn<unknown, [unknown]>().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn(async () => [
        { status: TransactionStatus.Active, count: '15' },
        { status: TransactionStatus.Dispute, count: '3' },
      ]),
    };
    const transactions = {
      findAndCount: jest
        .fn<Promise<unknown>, [unknown]>()
        .mockResolvedValue([[{ id: uuidOf(50) }], 1]),
      find: jest
        .fn<Promise<unknown>, [unknown]>()
        .mockResolvedValue([{ id: uuidOf(50) }]),
      findOne: jest.fn(async () => null),
      createQueryBuilder: jest.fn(() => builder),
    };
    const events = { find: jest.fn(async () => []) };

    return {
      builder,
      transactions,
      events,
      service: new MerchantDealsService(transactions as never, events as never),
    };
  };

  it('always scopes the list to the merchant and pages it', async () => {
    const { service, transactions } = build();

    await service.list(MERCHANT, {
      page: 2,
      limit: 10,
      sortBy: TransactionSortField.ExpiresAt,
      sortOrder: SortOrder.Asc,
      statuses: [TransactionStatus.Dispute, TransactionStatus.ManualReview],
    });

    const options = transactions.findAndCount.mock.calls[0][0] as {
      where: Record<string, unknown>;
      order: Record<string, string>;
      skip: number;
      take: number;
    };
    expect(options.where.merchantId).toBe(MERCHANT);
    expect(options.where.status).toBeInstanceOf(FindOperator);
    expect(options.order).toEqual({ expiresAt: 'ASC', id: 'ASC' });
    expect(options.skip).toBe(10);
    expect(options.take).toBe(10);
  });

  it('counts per status under the filters but never under a status filter, every status present', async () => {
    const { service, builder } = build();

    const counts = await service.statusCounts(MERCHANT, {
      statuses: [TransactionStatus.Success],
      idSearch: 'ab12',
    });

    const [{ where }] = builder.setFindOptions.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];
    expect(where.merchantId).toBe(MERCHANT);
    expect(where.status).toBeUndefined();
    expect(where.id).toBeInstanceOf(FindOperator);
    expect(counts[TransactionStatus.Active]).toBe(15);
    expect(counts[TransactionStatus.Dispute]).toBe(3);
    expect(counts[TransactionStatus.Canceled]).toBe(0);
  });

  it('exports up to the cap and refuses one row more', async () => {
    const { service, transactions } = build();

    await service.export(MERCHANT, {}, 5);
    expect(transactions.find).toHaveBeenCalledWith(
      expect.objectContaining({ take: 6 }),
    );

    transactions.find.mockResolvedValue(
      Array.from({ length: 6 }, (_, index) => ({ id: uuidOf(index) })),
    );
    await expect(service.export(MERCHANT, {}, 5)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('finds a deal only among the merchant’s own', async () => {
    const { service, transactions } = build();

    await expect(service.findOwn(MERCHANT, uuidOf(50))).rejects.toThrow(
      NotFoundException,
    );
    expect(transactions.findOne).toHaveBeenCalledWith({
      where: { id: uuidOf(50), merchantId: MERCHANT },
    });
  });

  it('reads the status history oldest first', async () => {
    const { service, events } = build();

    await service.statusHistory(uuidOf(50));

    expect(events.find).toHaveBeenCalledWith({
      where: { transactionId: uuidOf(50) },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
  });
});
