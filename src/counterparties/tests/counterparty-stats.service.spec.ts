import { toFiat } from '../../common/utils/to-fiat';
import { CounterpartyDailyVolume } from '../entities/counterparty-daily-volume.entity';
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
      await service.recordDealCreatedWithin(manager as never, 4);

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
      });

      expect(manager.query).not.toHaveBeenCalled();
    });

    it('bumps completed, paid, paid amount and last deposit for a paid deal', async () => {
      const resolvedAt = new Date('2026-11-01T22:30:00Z');

      await service.recordCompletedWithin(manager as never, 4, {
        paid: true,
        amountFiat: toFiat('1500.50'),
        resolvedAt,
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
      });

      expect(manager.query).toHaveBeenCalledTimes(1);
      expect(manager.query).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT'),
        [4, '2026-11-02', 1, '1500.50'],
      );
    });

    it('keeps the utc day when the business day has not turned yet', async () => {
      await service.recordCompletedWithin(manager as never, 4, {
        paid: true,
        amountFiat: toFiat('10'),
        resolvedAt: new Date('2026-11-01T20:30:00Z'),
      });

      expect(manager.query.mock.calls[0][1]).toEqual([
        4,
        '2026-11-01',
        1,
        '10.00',
      ]);
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

    it('writes the totals of each counterparty', async () => {
      await service.replaceAllWithin(manager as never, totals, []);

      const builder = builders[2];
      expect(assignedColumns(builder)).toMatchObject({
        dealCount: 5,
        completedCount: 4,
        paidCount: 3,
        disputeCount: 1,
        lastDepositAt: totals[0].lastDepositAt,
      });
      expect(builder.where).toHaveBeenCalledWith('id = :counterpartyId', {
        counterpartyId: 1,
      });
      expect(builder.setParameter).toHaveBeenCalledWith('paidAmount', '300.50');
    });

    it('writes the daily rows with formatted amounts', async () => {
      await service.replaceAllWithin(manager as never, [], days);

      expect(manager.query).toHaveBeenCalledWith(
        expect.stringContaining('counterparty_daily_volumes'),
        [1, '2026-11-01', 3, '300.50'],
      );
    });
  });
});
