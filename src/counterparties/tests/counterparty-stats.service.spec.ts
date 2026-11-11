import { toFiat } from '../../common/utils/to-fiat';
import { CounterpartyDailyRequest } from '../entities/counterparty-daily-request.entity';
import { CounterpartyDailyVolume } from '../entities/counterparty-daily-volume.entity';
import { CounterpartyTraderDailyVolume } from '../entities/counterparty-trader-daily-volume.entity';
import { CounterpartyTraderStats } from '../entities/counterparty-trader-stats.entity';
import { Counterparty } from '../entities/counterparty.entity';
import { CounterpartyStatsService } from '../services/counterparty-stats.service';

describe('CounterpartyStatsService', () => {
  let builders: Record<string, jest.Mock>[];
  let manager: {
    createQueryBuilder: jest.Mock;
    query: jest.Mock;
  };
  let service: CounterpartyStatsService;

  const newBuilder = () => {
    const chain: Record<string, jest.Mock> = {};
    for (const name of [
      'update',
      'set',
      'where',
      'setParameters',
      'setParameter',
      'delete',
      'from',
    ]) {
      chain[name] = jest.fn(() => chain);
    }
    chain.execute = jest.fn(async () => undefined);
    builders.push(chain);
    return chain;
  };

  const assignedColumns = (builder: Record<string, jest.Mock>) =>
    builder.set.mock.calls[0][0] as Record<string, unknown>;

  const writes = () =>
    (manager.query.mock.calls as [string, unknown[]][]).filter(
      ([sql]) => !sql.includes('pg_advisory_xact_lock'),
    );

  beforeEach(() => {
    builders = [];
    manager = {
      createQueryBuilder: jest.fn(newBuilder),
      query: jest.fn(),
    };
    service = new CounterpartyStatsService({
      get: jest.fn(() => 'Europe/Moscow'),
    } as never);
  });

  describe('recordDealCreatedWithin', () => {
    it('bumps only the deal count of that counterparty', async () => {
      await service.recordDealCreatedWithin(manager as never, 4, {
        traderUserId: null,
        createdAt: new Date('2026-11-01T22:00:00Z'),
      });

      const [builder] = builders;
      expect(builder.update).toHaveBeenCalledWith(Counterparty);
      expect(Object.keys(assignedColumns(builder))).toEqual(['dealCount']);
      expect(builder.where).toHaveBeenCalledWith('id = :counterpartyId', {
        counterpartyId: 4,
      });
      expect(builder.execute).toHaveBeenCalledTimes(1);
    });
  });

  describe('recordDisputeWithin', () => {
    it('bumps only the dispute count of that counterparty', async () => {
      await service.recordDisputeWithin(manager as never, 4);

      const [builder] = builders;
      expect(Object.keys(assignedColumns(builder))).toEqual(['disputeCount']);
      expect(builder.where).toHaveBeenCalledWith('id = :counterpartyId', {
        counterpartyId: 4,
      });
    });
  });

  describe('recordCompletedWithin', () => {
    it('bumps only the completed count for an unpaid deal', async () => {
      await service.recordCompletedWithin(manager as never, 4, {
        paid: false,
        amountFiat: toFiat('100.00'),
        resolvedAt: new Date('2026-11-01T22:30:00Z'),
        traderUserId: null,
      });

      expect(Object.keys(assignedColumns(builders[0]))).toEqual([
        'completedCount',
      ]);
    });

    it('leaves the daily volumes alone for an unpaid deal', async () => {
      await service.recordCompletedWithin(manager as never, 4, {
        paid: false,
        amountFiat: toFiat('100.00'),
        resolvedAt: new Date('2026-11-01T22:30:00Z'),
        traderUserId: null,
      });

      expect(writes()).toEqual([]);
    });

    it('bumps completed, paid, paid amount and last deposit for a paid deal', async () => {
      const resolvedAt = new Date('2026-11-01T22:30:00Z');

      await service.recordCompletedWithin(manager as never, 4, {
        paid: true,
        amountFiat: toFiat('1500.50'),
        resolvedAt,
        traderUserId: null,
      });

      const [builder] = builders;
      expect(Object.keys(assignedColumns(builder))).toEqual([
        'completedCount',
        'paidCount',
        'paidAmount',
        'lastDepositAt',
      ]);
      expect(builder.setParameters).toHaveBeenCalledWith({
        amount: '1500.50',
        resolvedAt,
      });
    });

    it('upserts the day in the business timezone with the amount as a formatted string', async () => {
      await service.recordCompletedWithin(manager as never, 4, {
        paid: true,
        amountFiat: toFiat('1500.50'),
        resolvedAt: new Date('2026-11-01T22:30:00Z'),
        traderUserId: null,
      });

      expect(writes()).toEqual([
        [
          expect.stringContaining('ON CONFLICT'),
          [4, '2026-11-02', 1, '1500.50'],
        ],
      ]);
    });

    it('keeps the utc day when the business day has not turned yet', async () => {
      await service.recordCompletedWithin(manager as never, 4, {
        paid: true,
        amountFiat: toFiat('10'),
        resolvedAt: new Date('2026-11-01T20:30:00Z'),
        traderUserId: null,
      });

      expect(writes()[0][1]).toEqual([4, '2026-11-01', 1, '10.00']);
    });
  });

  describe('replaceAllWithin', () => {
    const totals = [
      {
        counterpartyId: 1,
        dealCount: 5,
        completedCount: 4,
        paidCount: 3,
        disputeCount: 1,
        paidAmount: toFiat('300.5'),
        lastDepositAt: new Date('2026-11-01T10:00:00Z'),
      },
    ];
    const days = [
      {
        counterpartyId: 1,
        day: '2026-11-01',
        paidCount: 3,
        paidAmount: toFiat('300.5'),
      },
    ];

    it('resets every counter before writing anything', async () => {
      await service.replaceAllWithin(manager as never, [], []);

      expect(builders[0].update).toHaveBeenCalledWith(Counterparty);
      expect(assignedColumns(builders[0])).toMatchObject({
        dealCount: 0,
        completedCount: 0,
        paidCount: 0,
        disputeCount: 0,
        lastDepositAt: null,
      });
      expect(builders[0].where).not.toHaveBeenCalled();
    });

    it('empties the daily volumes before writing', async () => {
      await service.replaceAllWithin(manager as never, [], []);

      expect(builders[1].delete).toHaveBeenCalledTimes(1);
      expect(builders[1].from).toHaveBeenCalledWith(CounterpartyDailyVolume);
    });

    it('writes the totals of every counterparty in one statement per batch, money as strings', async () => {
      await service.replaceAllWithin(manager as never, totals, []);

      expect(builders).toHaveLength(2);
      expect(writes()).toEqual([
        [
          expect.stringContaining('FROM unnest($1::int[]'),
          [[1], [5], [4], [3], [1], ['300.50'], ['2026-11-01T10:00:00.000Z']],
        ],
      ]);
      expect(writes()[0][0]).toContain('UPDATE counterparties AS counterparty');
    });

    it('writes the daily rows in one insert per batch', async () => {
      await service.replaceAllWithin(manager as never, [], days);

      expect(writes()).toEqual([
        [
          expect.stringContaining('INSERT INTO counterparty_daily_volumes'),
          [[1], ['2026-11-01'], [3], ['300.50']],
        ],
      ]);
    });

    it('splits more than 5000 rows into batches', async () => {
      await service.replaceAllWithin(
        manager as never,
        [],
        Array.from({ length: 5001 }, (_, index) => ({
          ...days[0],
          counterpartyId: index + 1,
        })),
      );

      expect(writes().map(([, [ids]]) => (ids as number[]).length)).toEqual([
        5000, 1,
      ]);
    });
  });

  describe('the deal counters lock', () => {
    it('is taken shared by every live writer before it touches a row', async () => {
      const outcome = {
        paid: true,
        amountFiat: toFiat('1'),
        resolvedAt: new Date('2026-11-01T10:00:00Z'),
        traderUserId: null,
      };

      await service.recordDealCreatedWithin(manager as never, 4, {
        traderUserId: null,
        createdAt: new Date(),
      });
      await service.recordDisputeWithin(manager as never, 4);
      await service.recordCompletedWithin(manager as never, 4, outcome);
      await service.recordDisputePaidWithin(manager as never, 4, {
        ...outcome,
        newlyPaid: false,
      });

      const locks = (manager.query.mock.calls as [string, unknown[]][]).filter(
        ([sql]) => sql.includes('pg_advisory_xact_lock'),
      );
      expect(locks).toEqual(
        Array.from({ length: 4 }, () => [
          'SELECT pg_advisory_xact_lock_shared(hashtext($1))',
          ['counterparty_deal_counters'],
        ]),
      );
      expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(
        builders[0].execute.mock.invocationCallOrder[0],
      );
    });

    it('is taken exclusive by the rebuild', async () => {
      await service.lockDealCountersWithin(manager as never, 'exclusive');

      expect(manager.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        ['counterparty_deal_counters'],
      );
    });
  });

  describe('recordRequestWithin', () => {
    it('bumps the request count and keeps the latest request time', async () => {
      const receivedAt = new Date('2026-11-05T10:00:00Z');

      await service.recordRequestWithin(manager as never, 4, receivedAt);

      const [builder] = builders;
      expect(builder.update).toHaveBeenCalledWith(Counterparty);
      expect(Object.keys(assignedColumns(builder))).toEqual([
        'requestCount',
        'lastRequestAt',
      ]);
      expect(builder.where).toHaveBeenCalledWith('id = :counterpartyId', {
        counterpartyId: 4,
      });
      expect(builder.setParameter).toHaveBeenCalledWith(
        'receivedAt',
        receivedAt,
      );
    });

    it('adds one to the day of the request in the business timezone', async () => {
      await service.recordRequestWithin(
        manager as never,
        4,
        new Date('2026-11-04T21:30:00Z'),
      );

      expect(manager.query).toHaveBeenCalledWith(
        expect.stringContaining('counterparty_daily_requests'),
        [4, '2026-11-05', 1],
      );
    });
  });

  describe('replaceRequestsWithin', () => {
    it('resets the request counters and days, then writes the rebuilt ones', async () => {
      const last = new Date('2026-11-05T10:00:00Z');

      await service.replaceRequestsWithin(
        manager as never,
        [{ counterpartyId: 2, requestCount: 3, lastRequestAt: last }],
        [{ counterpartyId: 2, day: '2026-11-05', requestCount: 3 }],
      );

      expect(assignedColumns(builders[0])).toEqual({
        requestCount: 0,
        lastRequestAt: null,
      });
      expect(builders[0].where).not.toHaveBeenCalled();
      expect(builders[1].from).toHaveBeenCalledWith(CounterpartyDailyRequest);
      expect(builders).toHaveLength(2);
      expect(writes()).toEqual([
        [
          expect.stringContaining('UPDATE counterparties'),
          [[2], [3], ['2026-11-05T10:00:00.000Z']],
        ],
        [
          expect.stringContaining('INSERT INTO counterparty_daily_requests'),
          [[2], ['2026-11-05'], [3]],
        ],
      ]);
    });

    it('writes the rebuilt rows in batches of 5000, one statement per batch', async () => {
      const totals = Array.from({ length: 5001 }, (_, index) => ({
        counterpartyId: index + 1,
        requestCount: 1,
        lastRequestAt: null,
      }));
      const days = Array.from({ length: 5001 }, (_, index) => ({
        counterpartyId: index + 1,
        day: '2026-11-05',
        requestCount: 1,
      }));

      await service.replaceRequestsWithin(manager as never, totals, days);

      expect(writes().map(([, [ids]]) => (ids as number[]).length)).toEqual([
        5000, 1, 5000, 1,
      ]);
      expect(writes()[1][1][2]).toEqual([null]);
    });

    it('does not touch the deal counters', async () => {
      await service.replaceRequestsWithin(manager as never, [], []);

      expect(Object.keys(assignedColumns(builders[0]))).toEqual([
        'requestCount',
        'lastRequestAt',
      ]);
    });
  });

  describe('lockRequestCountersWithin', () => {
    it('takes the request counters lock shared for a count and exclusive for a rebuild', async () => {
      await service.lockRequestCountersWithin(manager as never, 'shared');
      await service.lockRequestCountersWithin(manager as never, 'exclusive');

      expect(manager.query.mock.calls).toEqual([
        [
          'SELECT pg_advisory_xact_lock_shared(hashtext($1))',
          ['counterparty_request_counters'],
        ],
        [
          'SELECT pg_advisory_xact_lock(hashtext($1))',
          ['counterparty_request_counters'],
        ],
      ]);
    });
  });
  describe('the counters of a client with one trader (TC08)', () => {
    const TRADER = '00000000-0000-4000-8000-000000000001';
    const traderRows = () =>
      manager.query.mock.calls.filter(([sql]) =>
        (sql as string).startsWith('INSERT INTO counterparty_trader_stats'),
      );
    const traderDays = () =>
      manager.query.mock.calls.filter(([sql]) =>
        (sql as string).startsWith(
          'INSERT INTO counterparty_trader_daily_volumes',
        ),
      );

    it('stamps the latest deal of the pair when a deal is created', async () => {
      const createdAt = new Date('2026-11-01T22:00:00Z');

      await service.recordDealCreatedWithin(manager as never, 4, {
        traderUserId: TRADER,
        createdAt,
      });

      expect(traderRows()).toEqual([
        [
          expect.stringContaining('GREATEST'),
          [4, TRADER, 0, 0, '0', null, createdAt],
        ],
      ]);
    });

    it('adds a canceled deal to completed only, and a paid one to paid, the amount and the day', async () => {
      const resolvedAt = new Date('2026-11-01T22:30:00Z');

      await service.recordCompletedWithin(manager as never, 4, {
        paid: false,
        amountFiat: toFiat('100'),
        resolvedAt,
        traderUserId: TRADER,
      });
      await service.recordCompletedWithin(manager as never, 4, {
        paid: true,
        amountFiat: toFiat('1500.50'),
        resolvedAt,
        traderUserId: TRADER,
      });

      expect(traderRows().map(([, values]) => values)).toEqual([
        [4, TRADER, 1, 0, '0', null, null],
        [4, TRADER, 1, 1, '1500.50', resolvedAt, null],
      ]);
      expect(traderDays().map(([, values]) => values)).toEqual([
        [4, TRADER, '2026-11-02', 1, '1500.50'],
      ]);
    });

    it('adds a dispute top-up as an amount, and a newly paid one as a payment too', async () => {
      const resolvedAt = new Date('2026-11-01T10:00:00Z');

      await service.recordDisputePaidWithin(manager as never, 4, {
        newlyPaid: false,
        amountFiat: toFiat('200'),
        resolvedAt,
        traderUserId: TRADER,
      });
      await service.recordDisputePaidWithin(manager as never, 4, {
        newlyPaid: true,
        amountFiat: toFiat('300'),
        resolvedAt,
        traderUserId: TRADER,
      });

      expect(traderRows().map(([, values]) => values)).toEqual([
        [4, TRADER, 0, 0, '200.00', resolvedAt, null],
        [4, TRADER, 0, 1, '300.00', resolvedAt, null],
      ]);
      expect(traderDays().map(([, values]) => values)).toEqual([
        [4, TRADER, '2026-11-01', 0, '200.00'],
        [4, TRADER, '2026-11-01', 1, '300.00'],
      ]);
    });

    it('writes nothing per trader for a deal without one', async () => {
      await service.recordDealCreatedWithin(manager as never, 4, {
        traderUserId: null,
        createdAt: new Date(),
      });
      await service.recordCompletedWithin(manager as never, 4, {
        paid: true,
        amountFiat: toFiat('1'),
        resolvedAt: new Date(),
        traderUserId: null,
      });

      expect(traderRows()).toEqual([]);
      expect(traderDays()).toEqual([]);
    });

    it('replaces every pair and every day on a rebuild', async () => {
      const lastPaidAt = new Date('2026-11-01T10:00:00Z');

      await service.replaceTraderStatsWithin(
        manager as never,
        [
          {
            counterpartyId: 4,
            traderUserId: TRADER,
            completedCount: 3,
            paidCount: 2,
            paidAmount: toFiat('2500'),
            lastPaidAt,
            lastDealAt: lastPaidAt,
          },
        ],
        [
          {
            counterpartyId: 4,
            traderUserId: TRADER,
            day: '2026-11-01',
            paidCount: 2,
            paidAmount: toFiat('2500'),
          },
        ],
      );

      expect(builders.map((builder) => builder.from.mock.calls[0][0])).toEqual([
        CounterpartyTraderStats,
        CounterpartyTraderDailyVolume,
      ]);
      expect(writes()).toEqual([
        [
          expect.stringContaining('FROM unnest($1::int[], $2::uuid[]'),
          [
            [4],
            [TRADER],
            [3],
            [2],
            ['2500.00'],
            [lastPaidAt.toISOString()],
            [lastPaidAt.toISOString()],
          ],
        ],
        [
          expect.stringContaining(
            'INSERT INTO counterparty_trader_daily_volumes',
          ),
          [[4], [TRADER], ['2026-11-01'], [2], ['2500.00']],
        ],
      ]);
    });
  });
});
