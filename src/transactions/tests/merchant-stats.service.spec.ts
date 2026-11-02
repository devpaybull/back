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

  describe('the cabinet dashboard', () => {
    const buildFull = (
      one: Record<string, string> | undefined,
      many: { day: string; amount: string }[] = [],
    ) => {
      const builder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        setParameter: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawOne: jest.fn(async () => one),
        getRawMany: jest.fn(async () => many),
      };
      const transactions = { createQueryBuilder: jest.fn(() => builder) };

      return {
        builder,
        service: new MerchantStatsService(transactions as never),
      };
    };

    it('sums the successful deals of the period in one query, pay-ins apart', async () => {
      const { service, builder } = buildFull({
        turnover: '1000.500000',
        creditedPayIn: '900.000000',
        payInCommission: '50.000000',
        successfulPayInCount: '52',
        successfulPayInAmount: '5200.000000',
      });

      const totals = await service.dashboardTotals(uuidOf(3), from, to);

      expect(builder.andWhere).toHaveBeenCalledWith(
        'transaction.status IN (:...statuses)',
        {
          statuses: [
            TransactionStatus.Success,
            TransactionStatus.SuccessChanged,
          ],
        },
      );
      expect(builder.andWhere).toHaveBeenCalledWith(
        'transaction.resolvedAt >= :from',
        { from },
      );
      expect(builder.andWhere).toHaveBeenCalledWith(
        'transaction.resolvedAt < :to',
        { to },
      );
      expect(builder.addSelect.mock.calls[0][0]).toContain(
        "transaction.kind = 'pay_in'",
      );
      expect(totals).toEqual({
        turnover: toCrypto('1000.5'),
        creditedPayIn: toCrypto(900),
        payInCommission: toCrypto(50),
        successfulPayInCount: 52,
        successfulPayInAmount: toCrypto(5200),
      });
    });

    it('has no lower bound for all time and answers zeros for nothing', async () => {
      const { service, builder } = buildFull(undefined);

      const totals = await service.dashboardTotals(uuidOf(3), null, to);

      expect(builder.andWhere).not.toHaveBeenCalledWith(
        'transaction.resolvedAt >= :from',
        expect.anything(),
      );
      expect(totals.turnover).toEqual(toCrypto(0));
      expect(totals.successfulPayInCount).toBe(0);
    });

    it('fills every one of the last 30 days of the business zone, zero where nothing resolved', async () => {
      const { service, builder } = buildFull(undefined, [
        { day: '2026-11-02', amount: '4521.520000' },
      ]);

      const series = await service.turnoverSeries(
        uuidOf(3),
        30,
        'Europe/Moscow',
        new Date('2026-11-02T22:30:00Z'),
      );

      expect(series).toHaveLength(30);
      expect(series[0]).toEqual({ day: '2026-10-05', amount: toCrypto(0) });
      expect(series[29]).toEqual({
        day: '2026-11-03',
        amount: toCrypto(0),
      });
      expect(series[28]).toEqual({
        day: '2026-11-02',
        amount: toCrypto('4521.52'),
      });
      expect(builder.andWhere).toHaveBeenCalledWith(
        'transaction.resolvedAt >= :from',
        { from: new Date('2026-10-04T21:00:00Z') },
      );
      expect(builder.setParameter).toHaveBeenCalledWith(
        'timeZone',
        'Europe/Moscow',
      );
    });
  });
});
