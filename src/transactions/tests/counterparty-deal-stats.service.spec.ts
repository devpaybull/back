import { Logger } from '@nestjs/common';
import { CounterpartyDealStatsService } from '../services/counterparty-deal-stats.service';
import { CounterpartyRequestCountersRebuild } from '../types/counterparty-request-counters-rebuild.enum';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { toFiat } from '../../common/utils/to-fiat';
import { TraderCounterpartySortField } from '../types/trader-counterparty-sort-field.enum';

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

describe('CounterpartyDealStatsService for a trader (TC08)', () => {
  const TRADER = '00000000-0000-4000-8000-000000000001';
  const REQ = '00000000-0000-4000-8000-000000000030';
  const NOW = new Date('2026-11-08T12:00:00Z');
  const WINDOW_START = new Date('2026-10-09T21:00:00Z');

  const build = (answers: unknown[][]) => {
    const queue = [...answers];
    const dataSource = { query: jest.fn(async () => queue.shift() ?? []) };
    const service = new CounterpartyDealStatsService(
      dataSource as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { get: () => 'Europe/Moscow' } as never,
    );

    return { service, dataSource };
  };

  const query = {
    page: 2,
    limit: 10,
    sortBy: TraderCounterpartySortField.Conversion,
    sortOrder: SortOrder.Asc,
    hideInactive: true,
  };

  it('asks nothing when no client is bound', async () => {
    const { service, dataSource } = build([]);

    const page = await service.traderCounterpartyPage(TRADER, [], query, NOW);

    expect(page.items).toEqual([]);
    expect(page.meta.total).toBe(0);
    expect(await service.traderCounterpartyDeposits(TRADER, [], NOW)).toEqual(
      [],
    );
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('pages the bound clients by their deals with this trader only, sorted and filtered in SQL', async () => {
    const { service, dataSource } = build([
      [
        {
          id: 7,
          bankDetailsId: REQ,
          active: true,
          completedCount: '8',
          paidCount: '4',
          paidAmount: '200002.00',
          lastDealAt: new Date('2026-11-07T10:00:00Z'),
        },
      ],
      [{ total: '11' }],
    ]);

    const page = await service.traderCounterpartyPage(
      TRADER,
      [
        { id: 7, bankDetailsId: REQ, available: true },
        { id: 8, bankDetailsId: REQ, available: false },
      ],
      query,
      NOW,
    );

    expect(page.items).toEqual([
      {
        id: 7,
        bankDetailsId: REQ,
        active: true,
        completedCount: 8,
        paidCount: 4,
        paidAmount: toFiat('200002'),
        lastDealAt: new Date('2026-11-07T10:00:00Z'),
      },
    ]);
    expect(page.meta).toEqual({ total: 11, page: 2, limit: 10, pages: 2 });

    const [[sql, parameters], [countSql, countParameters]] = dataSource.query
      .mock.calls as unknown as [string, unknown[]][];
    expect(sql).toContain('deal."traderUserId" = $1');
    expect(sql).toContain('deal."counterpartyId" = ANY($3::int[])');
    expect(sql).toContain(
      'COALESCE(bound.available AND stats."lastPaidAt" >= $6, false) AS active',
    );
    expect(sql).toContain('($7::boolean = false OR listed.active)');
    expect(sql).toContain(
      'ORDER BY CASE WHEN listed."completedCount" = 0 THEN NULL ELSE listed."paidCount"::numeric / listed."completedCount" END ASC NULLS LAST, listed.id ASC LIMIT $8 OFFSET $9',
    );
    expect(parameters).toEqual([
      TRADER,
      ['sbp', 'card', 'counterparty', 'mobile_commerce'],
      [7, 8],
      [REQ, REQ],
      [true, false],
      WINDOW_START,
      true,
      10,
      10,
    ]);
    expect(countSql).toContain('SELECT COUNT(*) AS total');
    expect(countParameters).toEqual(parameters.slice(0, 7));
  });

  it('sums the deposits of the bound clients with this trader per requisite, the 30-day window in the business zone', async () => {
    const { service, dataSource } = build([
      [
        {
          bankDetailsId: REQ,
          completedCount: '3',
          paidCount: '2',
          paidAmount: '3000.50',
          deposits30d: '1000.25',
        },
      ],
    ]);

    expect(
      await service.traderCounterpartyDeposits(
        TRADER,
        [{ id: 7, bankDetailsId: REQ, available: true }],
        NOW,
      ),
    ).toEqual([
      {
        bankDetailsId: REQ,
        completedCount: 3,
        paidCount: 2,
        paidAmount: toFiat('3000.5'),
        deposits30d: toFiat('1000.25'),
      },
    ]);

    const [[sql, parameters]] = dataSource.query.mock.calls as unknown as [
      string,
      unknown[],
    ][];
    expect(sql).toContain(
      'JOIN transactions deal ON deal."counterpartyId" = bound.id',
    );
    expect(sql).toContain('deal."resolvedAt" >= $5');
    expect(parameters[0]).toBe(TRADER);
    expect(parameters[4]).toEqual(WINDOW_START);
  });
});
