import { uuidOf } from '../../common/tests/uuid-of.spec';
import { toCrypto } from '../../common/utils/to-crypto';
import { MerchantStatsService } from '../services/merchant-stats.service';
import { TransactionKind } from '../types/transaction-kind.enum';
import { TransactionStatus } from '../types/transaction-status.enum';

describe('MerchantStatsService', () => {
  const from = new Date('2026-10-19T21:00:00Z');
  const to = new Date('2026-10-26T21:00:00Z');

  const build = (row: Record<string, string> | undefined) => {
    const builder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      setParameters: jest.fn().mockReturnThis(),
      getRawOne: jest.fn(async () => row),
    };
    const transactions = { createQueryBuilder: jest.fn(() => builder) };

    return {
      builder,
      transactions,
      service: new MerchantStatsService(transactions as never),
    };
  };

  it('counts and sums one merchant’s pay-ins in a single query: conversion by creation, turnover by resolution', async () => {
    const { service, builder, transactions } = build({
      total: '400',
      successful: '150',
      turnover: '65100.500000',
      turnoverCount: '150',
    });

    const stats = await service.payInStats(uuidOf(3), from, to);

    expect(transactions.createQueryBuilder).toHaveBeenCalledTimes(1);
    expect(builder.where).toHaveBeenCalledWith(
      'transaction.merchantId = :merchantId',
      { merchantId: uuidOf(3) },
    );
    expect(builder.andWhere).toHaveBeenCalledWith('transaction.kind = :kind', {
      kind: TransactionKind.PayIn,
    });
    expect(builder.setParameters).toHaveBeenCalledWith({
      from,
      to,
      statuses: [TransactionStatus.Success, TransactionStatus.SuccessChanged],
    });
    expect(builder.select.mock.calls[0][0]).toContain('transaction.createdAt');
    expect(builder.addSelect.mock.calls[1][0]).toContain(
      'SUM(transaction.amountCrypto)',
    );
    expect(builder.addSelect.mock.calls[1][0]).toContain(
      'transaction.resolvedAt',
    );
    expect(stats).toEqual({
      total: 400,
      successful: 150,
      turnover: toCrypto('65100.5'),
      turnoverCount: 150,
    });
  });

  it('answers zeros when the database answers nothing', async () => {
    const { service } = build(undefined);

    expect(await service.payInStats(uuidOf(3), from, to)).toEqual({
      total: 0,
      successful: 0,
      turnover: toCrypto(0),
      turnoverCount: 0,
    });
  });
});
