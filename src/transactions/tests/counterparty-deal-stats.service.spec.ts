import { Logger } from '@nestjs/common';
import { CounterpartyDealStatsService } from '../services/counterparty-deal-stats.service';
import { CounterpartyRequestCountersRebuild } from '../types/counterparty-request-counters-rebuild.enum';

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
    builder.getRawMany = jest.fn(async () => []);
    const manager = { name: 'manager' };
    const dataSource = {
      transaction: jest.fn(async (work: (m: typeof manager) => unknown) => {
        steps.push('begin');
        await work(manager);
        steps.push('commit');
      }),
    };
    const counterpartyStats = {
      replaceAllWithin: jest.fn(async () => {
        steps.push('deals');
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
      { createQueryBuilder: () => builder } as never,
      {} as never,
      counterpartyStats as never,
      requestLog as never,
      { get: () => 'Europe/Moscow' } as never,
    );

    return { service, steps, manager, counterpartyStats, requestLog };
  };

  it('reads the archive first, then counts Postgres and replaces the request counters under the exclusive lock in the deals’ transaction', async () => {
    const { service, steps, manager, counterpartyStats, requestLog } = build();

    const result = await service.rebuildCounterpartyStats();

    expect(steps).toEqual([
      'archive',
      'begin',
      'deals',
      'lock',
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

    expect(steps).toEqual(['begin', 'deals', 'commit']);
    expect(counterpartyStats.lockRequestCountersWithin).not.toHaveBeenCalled();
    expect(counterpartyStats.replaceRequestsWithin).not.toHaveBeenCalled();
    expect(result).toEqual({
      requestCounters: CounterpartyRequestCountersRebuild.Skipped,
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('archive down'));
    warn.mockRestore();
  });
});
