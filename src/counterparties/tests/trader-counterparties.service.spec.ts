import { SortOrder } from '../../common/enums/sort-order.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { toFiat } from '../../common/utils/to-fiat';
import { TraderCounterpartiesService } from '../services/trader-counterparties.service';
import { TraderCounterpartySortField } from '../types/trader-counterparty-sort-field.enum';

describe('TraderCounterpartiesService', () => {
  const TRADER = uuidOf(1);
  const REQ = uuidOf(30);
  const NOW = new Date('2026-11-08T12:00:00Z');

  const build = (answers: unknown[][]) => {
    const queue = [...answers];
    const repository = { query: jest.fn(async () => queue.shift() ?? []) };
    const service = new TraderCounterpartiesService(
      repository as never,
      { getOrThrow: () => 'Europe/Moscow' } as never,
    );

    return { service, repository };
  };

  const calls = (repository: { query: jest.Mock }) =>
    repository.query.mock.calls as unknown as [string, unknown[]][];

  const query = {
    page: 2,
    limit: 10,
    sortBy: TraderCounterpartySortField.Conversion,
    sortOrder: SortOrder.Asc,
    hideInactive: true,
  };

  it('asks nothing without requisites', async () => {
    const { service, repository } = build([]);

    const page = await service.page(TRADER, [], query, NOW);

    expect(page.items).toEqual([]);
    expect(page.meta.total).toBe(0);
    expect(await service.totalsByRequisite(TRADER, [], NOW)).toEqual([]);
    expect(repository.query).not.toHaveBeenCalled();
  });

  it('pages the clients bound to the requisites with the pair’s counters, filtered, sorted and counted in SQL', async () => {
    const { service, repository } = build([
      [
        {
          id: 7,
          bankDetailsId: REQ,
          active: true,
          completedCount: 8,
          paidCount: 4,
          paidAmount: '200002.00',
          lastDealAt: new Date('2026-11-07T10:00:00Z'),
        },
      ],
      [{ total: '11' }],
    ]);

    const page = await service.page(TRADER, [REQ], query, NOW);

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

    const [[sql, parameters], [countSql, countParameters]] = calls(repository);
    expect(sql).toContain('FROM counterparties counterparty');
    expect(sql).toContain(
      'LEFT JOIN counterparty_trader_stats stats\n    ON stats."counterpartyId" = counterparty.id AND stats."traderUserId" = $1',
    );
    expect(sql).toContain(
      'WHERE counterparty."bankDetailsId" = ANY($2::uuid[])',
    );
    expect(sql).toContain(
      'COALESCE(counterparty.enabled AND counterparty."blacklistedAt" IS NULL AND stats."lastPaidAt" >= $3, false) AS active',
    );
    expect(sql).toContain('($4::boolean = false OR listed.active)');
    expect(sql).toContain(
      'ORDER BY CASE WHEN listed."completedCount" = 0 THEN NULL ELSE listed."paidCount"::numeric / listed."completedCount" END ASC NULLS LAST, listed.id ASC LIMIT $5 OFFSET $6',
    );
    expect(sql).not.toContain('transactions');
    expect(parameters).toEqual([
      TRADER,
      [REQ],
      new Date('2026-10-09T21:00:00Z'),
      true,
      10,
      10,
    ]);
    expect(countSql).toContain('SELECT COUNT(*) AS total');
    expect(countParameters).toEqual(parameters.slice(0, 4));
  });

  it.each([
    [TraderCounterpartySortField.Id, 'listed.id DESC'],
    [TraderCounterpartySortField.Volume, 'listed."paidAmount" DESC'],
    [TraderCounterpartySortField.LastDealAt, 'listed."lastDealAt" DESC'],
    [
      TraderCounterpartySortField.AverageCheck,
      'listed."paidAmount" / listed."paidCount" END DESC',
    ],
  ])(
    'sorts by %s, empty values last, ties on the id',
    async (sortBy, order) => {
      const { service, repository } = build([[], [{ total: '0' }]]);

      await service.page(
        TRADER,
        [REQ],
        { ...query, sortBy, sortOrder: SortOrder.Desc },
        NOW,
      );

      expect(calls(repository)[0][0]).toContain(
        `${order} NULLS LAST, listed.id DESC`,
      );
    },
  );

  it('sums the clients of each requisite with the pair’s counters and the last 30 days of their buckets', async () => {
    const { service, repository } = build([
      [
        {
          bankDetailsId: REQ,
          bound: '2',
          completedCount: '10',
          paidCount: '4',
          paidAmount: '200002.00',
          deposits30d: '1000.25',
        },
      ],
    ]);

    expect(await service.totalsByRequisite(TRADER, [REQ], NOW)).toEqual([
      {
        bankDetailsId: REQ,
        bound: 2,
        completedCount: 10,
        paidCount: 4,
        paidAmount: toFiat('200002'),
        deposits30d: toFiat('1000.25'),
      },
    ]);

    const [[sql, parameters]] = calls(repository);
    expect(sql).toContain('FROM counterparty_trader_daily_volumes volume');
    expect(sql).toContain('volume.day >= $3::date');
    expect(sql).toContain('GROUP BY counterparty."bankDetailsId"');
    expect(parameters).toEqual([TRADER, [REQ], '2026-10-10']);
  });
});
