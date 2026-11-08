import { Logger } from '@nestjs/common';
import { CounterpartyDealStatsService } from '../services/counterparty-deal-stats.service';
import { CounterpartyRequestCountersRebuild } from '../types/counterparty-request-counters-rebuild.enum';
import { toFiat } from '../../common/utils/to-fiat';

const ARCHIVED = {
  totals: [
    {
      counterpartyId: 5,
      requestCount: 1,
      lastRequestAt: new Date('2026-10-01T00:00:00Z'),
    },
  ],
  days: [{ counterpartyId: 5, day: '2026-10-01', requestCount: 1 }],
};
const MERGED = {
  totals: [
    {
      counterpartyId: 5,
      requestCount: 3,
      lastRequestAt: new Date('2026-11-01T00:00:00Z'),
    },
  ],
  days: [{ counterpartyId: 5, day: '2026-11-01', requestCount: 2 }],
};

describe('CounterpartyDealStatsService.rebuildCounterpartyStats', () => {
  const build = () => {
    const steps: string[] = [];
    const builder: Record<string, jest.Mock> = {};
    for (const name of [
      'select',
      'addSelect',
      'where',
      'andWhere',
      'setParameter',
      'setParameters',
      'groupBy',
      'addGroupBy',
    ]) {
      builder[name] = jest.fn(() => builder);
    }
    builder.getRawMany = jest.fn(async () => {
      steps.push('read');
      return [];
    });
    const manager = {
      name: 'manager',
      createQueryBuilder: jest.fn(() => builder),
    };
    const repository = { createQueryBuilder: jest.fn(() => builder) };
    const dataSource = {
      transaction: jest.fn(async (work: (m: typeof manager) => unknown) => {
        steps.push('begin');
        await work(manager);
        steps.push('commit');
      }),
    };
    const counterpartyStats = {
      lockDealCountersWithin: jest.fn(async () => {
        steps.push('deal lock');
      }),
      replaceAllWithin: jest.fn(async () => {
        steps.push('deals');
      }),
      replaceTraderStatsWithin: jest.fn(async () => {
        steps.push('traders');
      }),
      lockRequestCountersWithin: jest.fn(async () => {
        steps.push('lock');
      }),
      replaceRequestsWithin: jest.fn(async () => {
        steps.push('requests');
      }),
    };
    const requestLog = {
      archivedCounterpartyRequestCounts: jest.fn(async () => {
        steps.push('archive');
        return ARCHIVED;
      }),
      storedCounterpartyRequestCountsWithin: jest.fn(async () => {
        steps.push('stored');
        return MERGED;
      }),
    };
    const service = new CounterpartyDealStatsService(
      dataSource as never,
      repository as never,
      {} as never,
      counterpartyStats as never,
      requestLog as never,
      { get: () => 'Europe/Moscow' } as never,
    );

    return {
      service,
      steps,
      manager,
      counterpartyStats,
      requestLog,
      builder,
      repository,
    };
  };

  it('counts a deal by the statuses it ever reached, not by the one it has now, like the live counters', async () => {
    const { service, builder } = build();
    const everPaid = `reached."toStatus" IN ('success', 'success_changed')`;
    const everCompleted = `reached."toStatus" IN ('success', 'success_changed', 'canceled')`;

    await service.rebuildCounterpartyStats();

    const selected = (builder.addSelect.mock.calls as [string][]).map(
      ([sql]) => sql,
    );
    const conditions = (builder.andWhere.mock.calls as [string][]).map(
      ([sql]) => sql,
    );
    expect(selected.filter((sql) => sql.includes(everCompleted))).toHaveLength(
      2,
    );
    expect(selected.filter((sql) => sql.includes(everPaid)).length).toBe(6);
    expect(selected.some((sql) => sql.includes('deal.status IN'))).toBe(false);
    expect(conditions.filter((sql) => sql.includes(everPaid))).toHaveLength(2);
    expect(conditions.some((sql) => sql.includes('deal.status IN'))).toBe(
      false,
    );
  });

  it('reads the deals through the transaction, after the exclusive deal counters lock', async () => {
    const { service, counterpartyStats, manager, repository } = build();

    await service.rebuildCounterpartyStats();

    expect(counterpartyStats.lockDealCountersWithin).toHaveBeenCalledWith(
      manager,
      'exclusive',
    );
    expect(manager.createQueryBuilder).toHaveBeenCalledTimes(4);
    expect(manager.createQueryBuilder).toHaveBeenCalledWith(
      expect.anything(),
      'deal',
    );
    expect(repository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('rebuilds the counters of each client with each trader from the trader’s pay-ins', async () => {
    const { service, counterpartyStats, builder, manager } = build();
    const lastPaidAt = new Date('2026-11-01T10:00:00Z');
    builder.getRawMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          counterpartyId: '4',
          traderUserId: 't-1',
          completedCount: '3',
          paidCount: '2',
          paidAmount: '2500.00',
          lastPaidAt,
          lastDealAt: lastPaidAt,
        },
      ])
      .mockResolvedValueOnce([
        {
          counterpartyId: '4',
          traderUserId: 't-1',
          day: '2026-11-01',
          paidCount: '2',
          paidAmount: '2500.00',
        },
      ]);

    await service.rebuildCounterpartyStats();

    expect(counterpartyStats.replaceTraderStatsWithin).toHaveBeenCalledWith(
      manager,
      [
        {
          counterpartyId: 4,
          traderUserId: 't-1',
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
          traderUserId: 't-1',
          day: '2026-11-01',
          paidCount: 2,
          paidAmount: toFiat('2500'),
        },
      ],
    );
    expect(builder.addGroupBy).toHaveBeenCalledWith('deal.traderUserId');
    expect(builder.andWhere).toHaveBeenCalledWith(
      'deal.traderUserId IS NOT NULL',
    );
  });

  it('reads the archive first, takes both exclusive locks before writing any row, then counts Postgres and replaces the request counters in the deals’ transaction', async () => {
    const { service, steps, manager, counterpartyStats, requestLog } = build();

    const result = await service.rebuildCounterpartyStats();

    expect(steps).toEqual([
      'archive',
      'begin',
      'deal lock',
      'lock',
      'read',
      'read',
      'read',
      'read',
      'deals',
      'traders',
      'stored',
      'requests',
      'commit',
    ]);
    expect(counterpartyStats.lockRequestCountersWithin).toHaveBeenCalledWith(
      manager,
      'exclusive',
    );
    expect(
      requestLog.storedCounterpartyRequestCountsWithin,
    ).toHaveBeenCalledWith(manager, 'Europe/Moscow', ARCHIVED);
    expect(counterpartyStats.replaceRequestsWithin).toHaveBeenCalledWith(
      manager,
      MERGED.totals,
      MERGED.days,
    );
    expect(result).toEqual({
      requestCounters: CounterpartyRequestCountersRebuild.Rebuilt,
    });
  });

  it('still rebuilds the deal counters when the archive cannot be read, leaves the request counters alone and says so', async () => {
    const { service, steps, counterpartyStats, requestLog } = build();
    requestLog.archivedCounterpartyRequestCounts.mockRejectedValueOnce(
      new Error('archive down'),
    );
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    const result = await service.rebuildCounterpartyStats();

    expect(steps).toEqual([
      'begin',
      'deal lock',
      'read',
      'read',
      'read',
      'read',
      'deals',
      'traders',
      'commit',
    ]);
    expect(counterpartyStats.lockRequestCountersWithin).not.toHaveBeenCalled();
    expect(counterpartyStats.replaceRequestsWithin).not.toHaveBeenCalled();
    expect(result).toEqual({
      requestCounters: CounterpartyRequestCountersRebuild.Skipped,
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('archive down'));
    warn.mockRestore();
  });
});
