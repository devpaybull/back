import { getMetadataArgsStorage } from 'typeorm';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { toCrypto } from '../../common/utils/to-crypto';
import { toFiat } from '../../common/utils/to-fiat';
import { Transaction } from '../entities/transaction.entity';
import { TraderStatsService } from '../services/trader-stats.service';
import { TransactionKind } from '../types/transaction-kind.enum';

type Row = Record<string, unknown> | undefined;

const builderOf = (one: Row, many: Row[] = []) => {
  const builder = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    setParameter: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    getRawOne: jest.fn(async () => one),
    getRawMany: jest.fn(async () => many),
  };

  return builder;
};

type Builder = ReturnType<typeof builderOf>;

const repositoryOf = (builders: Builder[]) => {
  const queue = [...builders];

  return { createQueryBuilder: jest.fn(() => queue.shift()) };
};

const conditionsOf = (builder: Builder): string[] =>
  [...builder.where.mock.calls, ...builder.andWhere.mock.calls].map(
    ([condition]) => condition as string,
  );

describe('TraderStatsService', () => {
  const TRADER = uuidOf(1);
  const range = {
    from: new Date('2026-11-07T21:00:00Z'),
    to: new Date('2026-11-08T21:00:00Z'),
  };

  describe('summary', () => {
    const build = (rows: {
      issue?: Row;
      created?: Row;
      resolved?: Row;
      payouts?: Row;
      disputes?: Row;
    }) => {
      const created = builderOf(rows.created);
      const resolved = builderOf(rows.resolved);
      const payouts = builderOf(rows.payouts);
      const issue = builderOf(rows.issue);
      const disputes = builderOf(rows.disputes);
      const transactions = repositoryOf([created, resolved, payouts]);
      const attempts = repositoryOf([issue]);
      const disputesRepository = repositoryOf([disputes]);

      return {
        created,
        resolved,
        payouts,
        issue,
        disputes,
        attempts,
        service: new TraderStatsService(
          transactions as never,
          attempts as never,
          disputesRepository as never,
        ),
      };
    };

    it('reads every card of the page from the trader’s own rows', async () => {
      const built = build({
        issue: { issued: '475', skipped: '25' },
        created: { paid: '475', canceled: '25' },
        resolved: {
          successCount: '3',
          turnover: '4650.15',
          volumeCrypto: '52.300000',
          income: '3.100000',
          depositSeconds: '314.4',
        },
        payouts: { payoutSeconds: '2534.6' },
        disputes: { disputeSeconds: '1394' },
      });

      const summary = await built.service.summary(TRADER, range, {});

      expect(summary).toEqual({
        issued: 475,
        skipped: 25,
        paid: 475,
        canceled: 25,
        successCount: 3,
        turnover: toFiat('4650.15'),
        volumeCrypto: toCrypto('52.3'),
        income: toCrypto('3.1'),
        depositSeconds: 314,
        payoutSeconds: 2535,
        disputeSeconds: 1394,
      });
      for (const builder of [
        built.created,
        built.resolved,
        built.payouts,
        built.disputes,
      ]) {
        expect(builder.where).toHaveBeenCalledWith(
          'deal.traderUserId = :traderUserId',
          { traderUserId: TRADER },
        );
      }
      expect(built.issue.where).toHaveBeenCalledWith(
        'attempt.traderUserId = :traderUserId',
        { traderUserId: TRADER },
      );
    });

    it('counts conversion by creation, money by resolution, a pay-out by its receipt, a dispute by its decision', async () => {
      const built = build({});

      await built.service.summary(TRADER, range, {});

      expect(conditionsOf(built.created)).toContain(
        'deal.createdAt >= :rangeFrom AND deal.createdAt < :rangeTo',
      );
      expect(conditionsOf(built.resolved)).toEqual(
        expect.arrayContaining([
          expect.stringContaining("'success', 'success_changed'"),
          'deal.resolvedAt >= :rangeFrom AND deal.resolvedAt < :rangeTo',
        ]),
      );
      expect(built.payouts.select.mock.calls[0][0]).toBe(
        'AVG(EXTRACT(EPOCH FROM deal.payoutCompletedAt - deal.payoutTakenAt))',
      );
      expect(conditionsOf(built.payouts)).toContain(
        'deal.payoutCompletedAt >= :rangeFrom AND deal.payoutCompletedAt < :rangeTo',
      );
      expect(built.disputes.andWhere).toHaveBeenCalledWith(
        'dispute.status IN (:...decided)',
        { decided: ['accepted', 'rejected'] },
      );
      expect(conditionsOf(built.issue)).toContain(
        'attempt.createdAt >= :rangeFrom AND attempt.createdAt < :rangeTo',
      );
    });

    it('answers zeros and nulls for an empty period', async () => {
      const built = build({});

      expect(await built.service.summary(TRADER, range, {})).toEqual({
        issued: 0,
        skipped: 0,
        paid: 0,
        canceled: 0,
        successCount: 0,
        turnover: toFiat(0),
        volumeCrypto: toCrypto(0),
        income: toCrypto(0),
        depositSeconds: null,
        payoutSeconds: null,
        disputeSeconds: null,
      });
    });

    it('has no issue conversion for pay-outs: selection is pay-in only', async () => {
      const built = build({});

      const summary = await built.service.summary(TRADER, range, {
        kind: TransactionKind.PayOut,
      });

      expect(built.attempts.createQueryBuilder).not.toHaveBeenCalled();
      expect(summary.issued).toBe(0);
      expect(summary.skipped).toBe(0);
    });

    it('applies the filters to the deals and to the journal, and all time has no lower bound', async () => {
      const built = build({});

      await built.service.summary(
        TRADER,
        { from: null, to: range.to },
        {
          kind: TransactionKind.PayIn,
          method: 'sbp',
          bankDetailsId: uuidOf(9),
        },
      );

      expect(built.created.andWhere).toHaveBeenCalledWith('deal.kind = :kind', {
        kind: TransactionKind.PayIn,
      });
      expect(built.created.andWhere).toHaveBeenCalledWith(
        'deal.method = :method',
        { method: 'sbp' },
      );
      expect(built.created.andWhere).toHaveBeenCalledWith(
        'deal.bankDetailsId = :bankDetailsId',
        { bankDetailsId: uuidOf(9) },
      );
      expect(built.created.andWhere).toHaveBeenCalledWith(
        'deal.createdAt < :rangeTo',
        { rangeTo: range.to },
      );
      expect(built.issue.andWhere).toHaveBeenCalledWith(
        'attempt.method = :method',
        { method: 'sbp' },
      );
      expect(built.issue.andWhere).toHaveBeenCalledWith(
        'attempt.bankDetailsId = :bankDetailsId',
        { bankDetailsId: uuidOf(9) },
      );
    });
  });

  describe('daily', () => {
    it('answers today and the 13 days before in the business zone, empty days present', async () => {
      const money = builderOf(undefined, [
        { day: '2026-11-08', income: '1.500000', turnover: '1000.00' },
      ]);
      const counts = builderOf(undefined, [
        {
          day: '2026-11-07',
          created: '4',
          paid: '2',
          canceled: '1',
          disputed: '1',
        },
      ]);
      const service = new TraderStatsService(
        repositoryOf([money, counts]) as never,
        repositoryOf([]) as never,
        repositoryOf([]) as never,
      );

      const days = await service.daily(
        TRADER,
        {},
        'Europe/Moscow',
        new Date('2026-11-08T20:59:59Z'),
      );

      expect(days).toHaveLength(14);
      expect(days[0].day).toBe('2026-10-26');
      expect(days[13]).toEqual({
        day: '2026-11-08',
        income: toCrypto('1.5'),
        turnover: toFiat(1000),
        created: 0,
        paid: 0,
        canceled: 0,
        disputed: 0,
      });
      expect(days[12]).toEqual({
        day: '2026-11-07',
        income: toCrypto(0),
        turnover: toFiat(0),
        created: 4,
        paid: 2,
        canceled: 1,
        disputed: 1,
      });
      expect(money.setParameter).toHaveBeenCalledWith(
        'timeZone',
        'Europe/Moscow',
      );
      expect(money.andWhere).toHaveBeenCalledWith(
        'deal.resolvedAt >= :rangeFrom AND deal.resolvedAt < :rangeTo',
        {
          rangeFrom: new Date('2026-10-25T21:00:00Z'),
          rangeTo: new Date('2026-11-08T21:00:00Z'),
        },
      );
      expect(counts.addSelect.mock.calls[3][0]).toContain(
        `"toStatus" = 'dispute'`,
      );
    });
  });

  describe('buckets', () => {
    it('answers the five buckets in order, empty ones as zeros', async () => {
      const builder = builderOf(undefined, [
        {
          bucket: 1,
          count: '62',
          volumeCrypto: '1250.540000',
          volumeFiat: '93000.00',
        },
        { bucket: '4', count: '1', volumeCrypto: '200', volumeFiat: '18000' },
      ]);
      const service = new TraderStatsService(
        repositoryOf([builder]) as never,
        repositoryOf([]) as never,
        repositoryOf([]) as never,
      );

      const buckets = await service.buckets(TRADER, range, {});

      expect(buckets.map((bucket) => bucket.label)).toEqual([
        '1-999',
        '1000-2000',
        '2001-5000',
        '5001-10000',
        '10000+',
      ]);
      expect(buckets[0]).toEqual({
        label: '1-999',
        count: 0,
        volumeCrypto: toCrypto(0),
        volumeFiat: toFiat(0),
      });
      expect(buckets[1].count).toBe(62);
      expect(buckets[1].volumeCrypto).toEqual(toCrypto('1250.54'));
      expect(buckets[4].volumeFiat).toEqual(toFiat(18000));
    });

    it('cuts below 1000, then up to 2000, 5000 and 10000 inclusive, successful deals by resolution', async () => {
      const builder = builderOf(undefined, []);
      const service = new TraderStatsService(
        repositoryOf([builder]) as never,
        repositoryOf([]) as never,
        repositoryOf([]) as never,
      );

      await service.buckets(TRADER, range, {});

      expect(builder.select.mock.calls[0][0]).toBe(
        'CASE WHEN deal.amountFiat < 1000 THEN 0 WHEN deal.amountFiat <= 2000 THEN 1 WHEN deal.amountFiat <= 5000 THEN 2 WHEN deal.amountFiat <= 10000 THEN 3 ELSE 4 END',
      );
      expect(conditionsOf(builder)).toEqual(
        expect.arrayContaining([
          expect.stringContaining("'success', 'success_changed'"),
          'deal.resolvedAt >= :rangeFrom AND deal.resolvedAt < :rangeTo',
        ]),
      );
    });
  });
});

describe('the indexes a trader’s figures read', () => {
  it('has (traderUserId, createdAt) and (traderUserId, resolvedAt) on transactions', () => {
    const columnsOf = getMetadataArgsStorage()
      .indices.filter((index) => index.target === Transaction)
      .map((index) => index.columns);

    expect(columnsOf).toEqual(
      expect.arrayContaining([
        ['traderUserId', 'createdAt'],
        ['traderUserId', 'resolvedAt'],
      ]),
    );
  });
});
