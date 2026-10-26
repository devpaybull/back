import { Brackets, In } from 'typeorm';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { toCrypto } from '../../common/utils/to-crypto';
import { AccountTransaction } from '../entities/account-transaction.entity';
import { DepositTransfer } from '../entities/deposit-transfer.entity';
import { WithdrawalAttempt } from '../entities/withdrawal-attempt.entity';
import { AccountTransactionsService } from '../services/account-transactions.service';
import { AccountTransactionListQuery } from '../types/account-transaction-list-query';
import { AccountTransactionSortField } from '../types/account-transaction-sort-field.enum';
import { AccountTransactionStatus } from '../types/account-transaction-status.enum';
import { AccountTransactionStatusReason } from '../types/account-transaction-status-reason.enum';
import { AccountTransactionType } from '../types/account-transaction-type.enum';

type Call = [string, ...unknown[]];

interface RecordingBuilder {
  calls: Call[];
  answers: Record<string, unknown>;
  [method: string]: unknown;
}

const recordingBuilder = (answers: Record<string, unknown> = {}) => {
  const calls: Call[] = [];
  const builder: RecordingBuilder = new Proxy(
    { calls, answers } as RecordingBuilder,
    {
      get(target, property: string) {
        if (property in target) return target[property];

        return (...args: unknown[]) => {
          calls.push([property, ...args]);

          return property in answers
            ? Promise.resolve(answers[property])
            : builder;
        };
      },
    },
  );

  return builder;
};

const bracketCalls = (bracket: unknown): Call[] => {
  const inner = recordingBuilder();
  (bracket as Brackets).whereFactory(inner as never);

  return inner.calls;
};

const build = (answers: Record<string, unknown>[] = []) => {
  const builders = answers.map((answer) => recordingBuilder(answer));
  let next = 0;
  const repositories = new Map<unknown, { find: jest.Mock }>([
    [AccountTransaction, { find: jest.fn(async () => []) }],
    [DepositTransfer, { find: jest.fn(async () => []) }],
    [WithdrawalAttempt, { find: jest.fn(async () => []) }],
  ]);
  const dataSource = {
    getRepository: jest.fn((entity: unknown) => ({
      ...repositories.get(entity),
      createQueryBuilder: jest.fn(() => builders[next++] ?? recordingBuilder()),
    })),
  };

  return {
    service: new AccountTransactionsService(dataSource as never),
    builders,
    repositories,
    dataSource,
  };
};

const query = (
  overrides: Partial<AccountTransactionListQuery> = {},
): AccountTransactionListQuery => ({
  type: AccountTransactionType.Deposit,
  page: 2,
  limit: 20,
  ...overrides,
});

const row = (id: number, userId: string) =>
  ({ id, userId }) as AccountTransaction;

describe('AccountTransactionsService.list', () => {
  it('filters by type always, and by every given filter in SQL', async () => {
    const { service, builders } = build([{ getManyAndCount: [[], 0] }]);
    const from = new Date('2026-10-01T00:00:00Z');
    const to = new Date('2026-10-31T00:00:00Z');

    await service.list(
      query({
        status: [
          AccountTransactionStatus.Pending,
          AccountTransactionStatus.Failed,
        ],
        statusReason: AccountTransactionStatusReason.BelowMinimum,
        userId: uuidOf(1),
        createdFrom: from,
        createdTo: to,
      }),
    );

    expect(builders[0].calls).toEqual(
      expect.arrayContaining([
        [
          'where',
          'entry.type = :type',
          { type: AccountTransactionType.Deposit },
        ],
        [
          'andWhere',
          'entry.status IN (:...statuses)',
          {
            statuses: [
              AccountTransactionStatus.Pending,
              AccountTransactionStatus.Failed,
            ],
          },
        ],
        [
          'andWhere',
          'entry.statusReason = :reason',
          { reason: AccountTransactionStatusReason.BelowMinimum },
        ],
        ['andWhere', 'entry.userId = :userId', { userId: uuidOf(1) }],
        ['andWhere', 'entry.createdAt >= :createdFrom', { createdFrom: from }],
        ['andWhere', 'entry.createdAt <= :createdTo', { createdTo: to }],
      ]),
    );
  });

  it('adds no filter that was not asked for', async () => {
    const { service, builders } = build([{ getManyAndCount: [[], 0] }]);

    await service.list(query({ status: [] }));

    expect(
      builders[0].calls.filter(([method]) => method === 'andWhere'),
    ).toEqual([]);
  });

  it('searches the id, the matched accounts, the address and every hash with an escaped pattern', async () => {
    const { service, builders } = build([{ getManyAndCount: [[], 0] }]);

    await service.list(query({ search: ' 42 ', matchedUserIds: [uuidOf(3)] }));

    const [, bracket] = builders[0].calls.find(
      ([method, value]) => method === 'andWhere' && value instanceof Brackets,
    )!;
    expect(bracketCalls(bracket)).toEqual([
      ['orWhere', 'entry.id = :searchId', { searchId: 42 }],
      [
        'orWhere',
        'entry.userId IN (:...matchedUserIds)',
        { matchedUserIds: [uuidOf(3)] },
      ],
      ['orWhere', 'entry.address ILIKE :like', { like: '%42%' }],
      ['orWhere', 'entry.txHash ILIKE :like', { like: '%42%' }],
      [
        'orWhere',
        expect.stringContaining('FROM deposit_transfers t'),
        { like: '%42%' },
      ],
      [
        'orWhere',
        expect.stringContaining('FROM withdrawal_attempts a'),
        { like: '%42%' },
      ],
    ]);
  });

  it('escapes LIKE wildcards and skips the id for a non-numeric term', async () => {
    const { service, builders } = build([{ getManyAndCount: [[], 0] }]);

    await service.list(query({ search: 'ab_%' }));

    const [, bracket] = builders[0].calls.find(
      ([method, value]) => method === 'andWhere' && value instanceof Brackets,
    )!;
    const calls = bracketCalls(bracket);
    expect(calls.map(([, sql]) => sql)).not.toContain('entry.id = :searchId');
    expect(calls[0]).toEqual([
      'orWhere',
      'entry.address ILIKE :like',
      { like: '%ab\\_\\%%' },
    ]);
  });

  it('does not search the id for a number above int4', async () => {
    const { service, builders } = build([{ getManyAndCount: [[], 0] }]);

    await service.list(query({ search: '9999999999' }));

    const [, bracket] = builders[0].calls.find(
      ([method, value]) => method === 'andWhere' && value instanceof Brackets,
    )!;
    expect(bracketCalls(bracket).map(([, sql]) => sql)).not.toContain(
      'entry.id = :searchId',
    );
  });

  it.each([
    [AccountTransactionSortField.Id, 'entry.id'],
    [AccountTransactionSortField.CreatedAt, 'entry.createdAt'],
    [AccountTransactionSortField.Amount, 'entry.amount'],
    [AccountTransactionSortField.Fee, 'entry.fee'],
  ])(
    'sorts by %s on %s, tie-broken on id, and pages',
    async (sortBy, column) => {
      const { service, builders } = build([
        { getManyAndCount: [[row(1, uuidOf(1))], 41] },
      ]);

      const page = await service.list(
        query({ sortBy, sortOrder: SortOrder.Asc }),
      );

      expect(builders[0].calls).toEqual(
        expect.arrayContaining([
          ['orderBy', column, 'ASC', 'NULLS LAST'],
          ['addOrderBy', 'entry.id', 'ASC'],
          ['skip', 20],
          ['take', 20],
        ]),
      );
      expect(page.meta).toMatchObject({
        total: 41,
        page: 2,
        limit: 20,
        pages: 3,
      });
    },
  );

  it('sorts newest first by default with NULLS FIRST', async () => {
    const { service, builders } = build([{ getManyAndCount: [[], 0] }]);

    await service.list(query());

    expect(builders[0].calls).toContainEqual([
      'orderBy',
      'entry.createdAt',
      'DESC',
      'NULLS FIRST',
    ]);
  });

  it('orders by the account’s rank, then id, and loads only the page', async () => {
    const { service, builders, repositories } = build([
      {
        getMany: [
          row(5, uuidOf(2)),
          row(3, uuidOf(1)),
          row(4, uuidOf(2)),
          row(1, uuidOf(3)),
        ],
      },
    ]);
    repositories
      .get(AccountTransaction)!
      .find.mockResolvedValue([row(3, uuidOf(1)), row(4, uuidOf(2))]);

    const page = await service.list(
      query({
        page: 1,
        limit: 2,
        sortBy: AccountTransactionSortField.User,
        sortOrder: SortOrder.Asc,
        userRanks: new Map([
          [uuidOf(1), 0],
          [uuidOf(2), 1],
          [uuidOf(3), 2],
        ]),
      }),
    );

    expect(builders[0].calls).toContainEqual([
      'select',
      ['entry.id', 'entry.userId'],
    ]);
    expect(repositories.get(AccountTransaction)!.find).toHaveBeenCalledWith({
      where: { id: In([3, 4]) },
    });
    expect(page.items.map((item) => item.id)).toEqual([3, 4]);
    expect(page.meta.total).toBe(4);
  });

  it('reverses the rank order descending', async () => {
    const { service, repositories } = build([
      { getMany: [row(3, uuidOf(1)), row(4, uuidOf(2))] },
    ]);
    repositories
      .get(AccountTransaction)!
      .find.mockResolvedValue([row(3, uuidOf(1)), row(4, uuidOf(2))]);

    const page = await service.list(
      query({
        page: 1,
        sortBy: AccountTransactionSortField.User,
        sortOrder: SortOrder.Desc,
        userRanks: new Map([
          [uuidOf(1), 0],
          [uuidOf(2), 1],
        ]),
      }),
    );

    expect(page.items.map((item) => item.id)).toEqual([4, 3]);
  });

  it('answers an empty page without a second query when the page is past the end', async () => {
    const { service, repositories } = build([{ getMany: [row(1, uuidOf(1))] }]);

    const page = await service.list(
      query({ page: 3, sortBy: AccountTransactionSortField.User }),
    );

    expect(repositories.get(AccountTransaction)!.find).not.toHaveBeenCalled();
    expect(page.items).toEqual([]);
    expect(page.meta.total).toBe(1);
  });
});

describe('AccountTransactionsService helpers', () => {
  it('reads the distinct accounts of the filtered rows', async () => {
    const { service, builders } = build([
      { getRawMany: [{ userId: uuidOf(1) }, { userId: uuidOf(2) }] },
    ]);

    await expect(service.userIdsOf(query())).resolves.toEqual([
      uuidOf(1),
      uuidOf(2),
    ]);
    expect(builders[0].calls).toEqual(
      expect.arrayContaining([
        ['select', 'entry.userId', 'userId'],
        ['distinct', true],
      ]),
    );
  });

  it('exports newest first and reads one row past the cap', async () => {
    const { service, builders } = build([{ getMany: [] }]);

    await service.exportRows(query(), 1000);

    expect(builders[0].calls).toEqual(
      expect.arrayContaining([
        ['orderBy', 'entry.createdAt', 'DESC'],
        ['addOrderBy', 'entry.id', 'DESC'],
        ['take', 1001],
      ]),
    );
  });

  it('groups transfers and attempts by their account transaction', async () => {
    const { service, repositories } = build();
    repositories.get(DepositTransfer)!.find.mockResolvedValue([
      { accountTransactionId: 1, txHash: 'a' },
      { accountTransactionId: 2, txHash: 'b' },
      { accountTransactionId: 1, txHash: 'c' },
    ]);
    repositories
      .get(WithdrawalAttempt)!
      .find.mockResolvedValue([{ accountTransactionId: 7, txHash: 'd' }]);

    const transfers = await service.transfersOf([1, 2]);
    const attempts = await service.attemptsOf([7]);

    expect(transfers.get(1)!.map((transfer) => transfer.txHash)).toEqual([
      'a',
      'c',
    ]);
    expect(transfers.get(2)).toHaveLength(1);
    expect(attempts.get(7)).toHaveLength(1);
    expect(repositories.get(DepositTransfer)!.find).toHaveBeenCalledWith({
      where: { accountTransactionId: In([1, 2]) },
      order: { id: 'ASC' },
    });
  });

  it('answers an empty id list without querying', async () => {
    const { service, repositories } = build();

    await expect(service.transfersOf([])).resolves.toEqual(new Map());
    await expect(service.attemptsOf([])).resolves.toEqual(new Map());
    expect(repositories.get(DepositTransfer)!.find).not.toHaveBeenCalled();
    expect(repositories.get(WithdrawalAttempt)!.find).not.toHaveBeenCalled();
  });
});

describe('AccountTransactionsService.stats', () => {
  const NOW = new Date('2026-10-25T12:00:00.000Z');

  it('maps the grouped counts, filling every missing status with zero', async () => {
    const { service } = build([
      {
        getRawMany: [
          { status: AccountTransactionStatus.Pending, count: '4' },
          { status: AccountTransactionStatus.Failed, count: '2' },
        ],
      },
      {
        getRawOne: {
          completedCount: '3',
          completedAmount: '1500.5',
          finished: '5',
          stale: '1',
          belowMinimum: '2',
        },
      },
    ]);

    await expect(
      service.stats(AccountTransactionType.Deposit, NOW, 30),
    ).resolves.toEqual({
      byStatus: {
        pending: 4,
        processing: 0,
        completed: 0,
        failed: 2,
        canceled: 0,
      },
      belowMinimum: 2,
      completedLast24h: { count: 3, amount: toCrypto('1500.5') },
      finishedLast24h: 5,
      staleProcessing: 1,
    });
  });

  it('sums the credited amount for deposits, with dates and enums as parameters only', async () => {
    const { service, builders } = build([
      { getRawMany: [] },
      { getRawOne: undefined },
    ]);

    const stats = await service.stats(AccountTransactionType.Deposit, NOW, 30);

    const totals = builders[1].calls;
    expect(
      totals.some(
        ([method, sql]) =>
          method === 'addSelect' &&
          String(sql).includes('SUM(entry.creditedAmount)'),
      ),
    ).toBe(true);
    const [, parameters] = totals.find(
      ([method]) => method === 'setParameters',
    )!;
    expect(parameters).toEqual({
      completed: AccountTransactionStatus.Completed,
      processing: AccountTransactionStatus.Processing,
      belowMinimum: AccountTransactionStatusReason.BelowMinimum,
      final: [
        AccountTransactionStatus.Completed,
        AccountTransactionStatus.Failed,
        AccountTransactionStatus.Canceled,
      ],
      since: new Date(NOW.getTime() - 86_400_000),
      staleBefore: new Date(NOW.getTime() - 30 * 60_000),
    });
    expect(stats.completedLast24h).toEqual({ count: 0, amount: toCrypto(0) });
  });

  it('sums the amount for withdrawals', async () => {
    const { service, builders } = build([
      { getRawMany: [] },
      { getRawOne: {} },
    ]);

    await service.stats(AccountTransactionType.Withdrawal, NOW, 30);

    expect(
      builders[1].calls.some(
        ([method, sql]) =>
          method === 'addSelect' && String(sql).includes('SUM(entry.amount)'),
      ),
    ).toBe(true);
    expect(builders[0].calls).toContainEqual([
      'where',
      'entry.type = :type',
      { type: AccountTransactionType.Withdrawal },
    ]);
  });
});

describe('AccountTransactionsService history', () => {
  it('lists the rows on either side of the account with every filter', async () => {
    const { service, builders } = build([{ getManyAndCount: [[], 0] }]);
    const from = new Date('2026-10-01T00:00:00Z');
    const to = new Date('2026-11-01T00:00:00Z');

    await service.history({
      userId: uuidOf(1),
      page: 1,
      limit: 20,
      sortBy: 'amount',
      sortOrder: SortOrder.Asc,
      type: [AccountTransactionType.Deposit],
      status: [AccountTransactionStatus.Completed],
      from,
      to,
    });

    const calls = builders[0].calls;
    const [, bracket] = calls.find(([method]) => method === 'where')!;
    expect(bracketCalls(bracket)).toEqual([
      ['where', 'entry.userId = :me', { me: uuidOf(1) }],
      ['orWhere', 'entry.counterpartyUserId = :me', { me: uuidOf(1) }],
    ]);
    expect(calls).toEqual(
      expect.arrayContaining([
        ['andWhere', 'entry.type IN (:...types)', { types: ['deposit'] }],
        [
          'andWhere',
          'entry.status IN (:...statuses)',
          { statuses: ['completed'] },
        ],
        ['andWhere', 'entry.createdAt >= :from', { from }],
        ['andWhere', 'entry.createdAt < :to', { to }],
        ['orderBy', 'entry.amount', 'ASC'],
        ['addOrderBy', 'entry.id', 'ASC'],
        ['skip', 0],
        ['take', 20],
      ]),
    );
  });

  it('sorts history newest first by default', async () => {
    const { service, builders } = build([{ getManyAndCount: [[], 0] }]);

    await service.history({ userId: uuidOf(1), page: 1, limit: 20 });

    expect(builders[0].calls).toContainEqual([
      'orderBy',
      'entry.createdAt',
      'DESC',
    ]);
    expect(
      builders[0].calls.filter(([method]) => method === 'andWhere'),
    ).toEqual([]);
  });

  it('counts per type, zero for a type with no row', async () => {
    const { service, builders } = build([
      { getRawMany: [{ type: AccountTransactionType.Deposit, count: '3' }] },
    ]);

    await expect(service.historyCounts({ userId: uuidOf(1) })).resolves.toEqual(
      {
        deposit: 3,
        withdrawal: 0,
        transfer: 0,
      },
    );
    expect(builders[0].calls).toContainEqual(['groupBy', 'entry.type']);
  });
});
