import { Logger } from '@nestjs/common';
import {
  And,
  Equal,
  FindOperator,
  In,
  LessThanOrEqual,
  MoreThan,
} from 'typeorm';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { Transaction } from '../entities/transaction.entity';
import { TransactionStatusEvent } from '../entities/transaction-status-event.entity';
import { DealExpiryService } from '../services/deal-expiry.service';
import { TransactionService } from '../services/transaction.service';
import { StatusEventSource } from '../types/status-event-source.enum';
import { TransactionKind } from '../types/transaction-kind.enum';
import { TransactionStatus } from '../types/transaction-status.enum';

const NOW = new Date('2026-10-24T12:00:00.000Z');
const PAST = new Date('2026-10-24T11:59:59.000Z');
const FUTURE = new Date('2026-10-24T12:00:01.000Z');
const TICKING = [TransactionStatus.Pending, TransactionStatus.Active];

const config = (values: Record<string, unknown>) =>
  ({ get: (key: string) => values[key] }) as never;

const deal = (n: number, overrides: Partial<Transaction> = {}): Transaction =>
  ({
    id: uuidOf(n),
    kind: TransactionKind.PayIn,
    status: TransactionStatus.Active,
    traderUserId: uuidOf(1),
    traderAmount: 10 + n,
    expiresAt: PAST,
    ...overrides,
  }) as Transaction;

const compare = (left: unknown, right: unknown): number => {
  const a = left instanceof Date ? left.getTime() : (left as string | number);
  const b =
    right instanceof Date ? right.getTime() : (right as string | number);

  return a < b ? -1 : a > b ? 1 : 0;
};

const holds = (condition: unknown, actual: unknown): boolean => {
  if (!(condition instanceof FindOperator)) return actual === condition;
  if (condition.type === 'and') {
    return (condition.value as unknown[]).every((part) => holds(part, actual));
  }
  if (condition.type === 'in') {
    return (condition.value as unknown[]).includes(actual);
  }
  if (actual === null || actual === undefined) return false;

  const order = compare(actual, condition.value);
  switch (condition.type) {
    case 'equal':
      return order === 0;
    case 'moreThan':
      return order > 0;
    case 'lessThanOrEqual':
      return order <= 0;
    default:
      throw new Error(`Unsupported operator ${condition.type}`);
  }
};

const matchesWhere = (
  row: Transaction,
  where: Record<string, unknown> | Record<string, unknown>[],
): boolean =>
  (Array.isArray(where) ? where : [where]).some((branch) =>
    Object.entries(branch).every(([key, condition]) =>
      holds(condition, (row as unknown as Record<string, unknown>)[key]),
    ),
  );

const build = (rows: Transaction[]) => {
  const db = new Map(rows.map((row) => [row.id, row]));
  const lockedElsewhere = new Set<string>();
  const changedAfterSelection = new Map<string, TransactionStatus>();
  const saved: unknown[] = [];

  const matchesSql = (row: Transaction, now: Date): boolean =>
    TICKING.includes(row.status) &&
    row.expiresAt !== null &&
    row.expiresAt.getTime() <= now.getTime();

  const lockCalls: Record<string, unknown[][]> = {};
  const lockedSelect = () => {
    const params: Record<string, unknown> = {};
    const builder: Record<string, jest.Mock> = {};
    for (const method of ['where', 'andWhere', 'setLock', 'setOnLocked']) {
      builder[method] = jest.fn((...args: unknown[]) => {
        (lockCalls[method] ??= []).push(args);
        if (args[1] && typeof args[1] === 'object') {
          Object.assign(params, args[1]);
        }
        return builder;
      });
    }
    builder.getOne = jest.fn(async () => {
      const id = params.id as string;
      const row = db.get(id);
      if (!row || lockedElsewhere.has(id)) return null;
      if (changedAfterSelection.has(id)) {
        row.status = changedAfterSelection.get(id);
      }
      return matchesSql(row, params.now as Date) ? row : null;
    });
    return builder;
  };

  const manager = {
    getRepository: jest.fn(() => ({ createQueryBuilder: lockedSelect })),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({
      ...data,
    })),
    save: jest.fn(async (row: unknown) => {
      saved.push(row);
      return row;
    }),
    find: jest.fn(async () => []),
  };
  const repository = {
    find: jest.fn(
      async (options: {
        where: Record<string, unknown> | Record<string, unknown>[];
        take: number;
      }): Promise<Transaction[]> =>
        [...db.values()]
          .filter((row) => matchesWhere(row, options.where))
          .sort(
            (a, b) => compare(a.expiresAt, b.expiresAt) || compare(a.id, b.id),
          )
          .slice(0, options.take)
          .map(
            (row) => ({ id: row.id, expiresAt: row.expiresAt }) as Transaction,
          ),
    ),
    manager: { transaction: jest.fn(async (work) => work(manager)) },
  };
  const wallets = {
    releaseEscrowWithin: jest.fn<Promise<void>, [unknown, string]>(
      async () => undefined,
    ),
    debitMainWithin: jest.fn(async () => undefined),
    creditMainWithin: jest.fn(async () => undefined),
    creditLeadShareWithin: jest.fn(async () => undefined),
  };
  const merchantBalances = {
    releasePayOutWithin: jest.fn(async () => null),
  };
  const transactions = new TransactionService(
    {} as never,
    {} as never,
    wallets as never,
    merchantBalances as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const service = new DealExpiryService(
    repository as never,
    transactions,
    config({ DEAL_EXPIRY_INTERVAL_SECONDS: 30 }),
  );

  return {
    service,
    transactions,
    repository,
    manager,
    wallets,
    merchantBalances,
    saved,
    lockCalls,
    lockedElsewhere,
    changedAfterSelection,
  };
};

const eventsOf = (saved: unknown[]): TransactionStatusEvent[] =>
  saved.filter(
    (row): row is TransactionStatusEvent =>
      (row as TransactionStatusEvent).toStatus !== undefined &&
      (row as TransactionStatusEvent).transactionId !== undefined,
  );

describe('DealExpiryService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('selects only pending and active deals whose deadline has passed', async () => {
    const { service, repository } = build([]);

    await service.run(NOW);

    expect(repository.find).toHaveBeenCalledWith({
      select: { id: true, expiresAt: true },
      where: {
        status: In(TICKING),
        expiresAt: LessThanOrEqual(NOW),
      },
      order: { expiresAt: 'ASC', id: 'ASC' },
      take: 100,
    });
  });

  it('re-reads each deal under a row lock that skips rows another instance holds', async () => {
    const { service, lockCalls } = build([deal(1)]);

    await service.run(NOW);

    expect(lockCalls.where).toEqual([
      ['transaction.id = :id', { id: uuidOf(1) }],
    ]);
    expect(lockCalls.andWhere).toEqual([
      ['transaction.status IN (:...statuses)', { statuses: TICKING }],
      ['transaction.expiresAt <= :now', { now: NOW }],
    ]);
    expect(lockCalls.setLock).toEqual([['pessimistic_write']]);
    expect(lockCalls.setOnLocked).toEqual([['skip_locked']]);
  });

  it('cancels an expired active pay-in as the system, releasing its escrow as a manual cancel does', async () => {
    const row = deal(1);
    const { service, wallets, manager, saved } = build([row]);

    await expect(service.run(NOW)).resolves.toBe(1);

    expect(row.status).toBe(TransactionStatus.Canceled);
    expect(row.resolvedAt).toBeInstanceOf(Date);
    expect(wallets.releaseEscrowWithin).toHaveBeenCalledWith(
      manager,
      uuidOf(1),
      11,
    );
    expect(eventsOf(saved)).toEqual([
      expect.objectContaining({
        transactionId: uuidOf(1),
        fromStatus: TransactionStatus.Active,
        toStatus: TransactionStatus.Canceled,
        source: StatusEventSource.AutoTimer,
        actorUserId: null,
        reason: 'expired',
      }),
    ]);
  });

  it('cancels expired pending and active pay-outs without touching a balance', async () => {
    const pending = deal(1, {
      kind: TransactionKind.PayOut,
      status: TransactionStatus.Pending,
    });
    const active = deal(2, { kind: TransactionKind.PayOut });
    const { service, wallets } = build([pending, active]);

    await expect(service.run(NOW)).resolves.toBe(2);

    expect(pending.status).toBe(TransactionStatus.Canceled);
    expect(active.status).toBe(TransactionStatus.Canceled);
    expect(wallets.releaseEscrowWithin).not.toHaveBeenCalled();
  });

  it('returns the merchant’s held amount when an expired pay-out is canceled', async () => {
    const row = deal(1, {
      kind: TransactionKind.PayOut,
      merchantId: uuidOf(3),
      merchantAmount: 7 as never,
    });
    const { service, merchantBalances, manager } = build([row]);

    await expect(service.run(NOW)).resolves.toBe(1);

    expect(merchantBalances.releasePayOutWithin).toHaveBeenCalledWith(
      manager,
      uuidOf(3),
      uuidOf(1),
    );
  });

  it.each([
    TransactionStatus.Checking,
    TransactionStatus.CheckingManually,
    TransactionStatus.ManualReview,
    TransactionStatus.Dispute,
    TransactionStatus.Success,
    TransactionStatus.Canceled,
  ])('leaves an expired deal in %s alone', async (status) => {
    const row = deal(1, { status });
    const { service, transactions, wallets } = build([row]);
    const transition = jest.spyOn(transactions, 'transitionLocked');

    await expect(service.run(NOW)).resolves.toBe(0);

    expect(row.status).toBe(status);
    expect(transition).not.toHaveBeenCalled();
    expect(wallets.releaseEscrowWithin).not.toHaveBeenCalled();
  });

  it('leaves a deal whose deadline has not come yet, and one with no deadline', async () => {
    const early = deal(1, { expiresAt: FUTURE });
    const undated = deal(2, { expiresAt: null });
    const { service } = build([early, undated]);

    await expect(service.run(NOW)).resolves.toBe(0);

    expect(early.status).toBe(TransactionStatus.Active);
    expect(undated.status).toBe(TransactionStatus.Active);
  });

  it('cancels a pay-out that went active → pending → active, from its original deadline', async () => {
    const row = deal(1, {
      kind: TransactionKind.PayOut,
      status: TransactionStatus.Active,
      expiresAt: PAST,
    });
    const { service } = build([row]);

    await expect(service.run(NOW)).resolves.toBe(1);
    expect(row.status).toBe(TransactionStatus.Canceled);
  });

  it('does not touch a deal that moved to checking between selection and the lock', async () => {
    const row = deal(1);
    const { service, wallets, saved, changedAfterSelection } = build([row]);
    changedAfterSelection.set(row.id, TransactionStatus.Checking);

    await expect(service.run(NOW)).resolves.toBe(0);

    expect(row.status).toBe(TransactionStatus.Checking);
    expect(wallets.releaseEscrowWithin).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
  });

  it('does not touch a deal that was completed between selection and the lock', async () => {
    const row = deal(1);
    const { service, wallets, changedAfterSelection } = build([row]);
    changedAfterSelection.set(row.id, TransactionStatus.Success);

    await expect(service.run(NOW)).resolves.toBe(0);

    expect(row.status).toBe(TransactionStatus.Success);
    expect(wallets.releaseEscrowWithin).not.toHaveBeenCalled();
  });

  it('skips a deal another instance holds the lock on, and cancels the rest', async () => {
    const held = deal(1);
    const free = deal(2);
    const { service, lockedElsewhere } = build([held, free]);
    lockedElsewhere.add(held.id);

    await expect(service.run(NOW)).resolves.toBe(1);

    expect(held.status).toBe(TransactionStatus.Active);
    expect(free.status).toBe(TransactionStatus.Canceled);
  });

  it('keeps going past a deal whose cancel fails, each deal in its own transaction', async () => {
    const failing = deal(1);
    const fine = deal(2);
    const { service, wallets, repository } = build([failing, fine]);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    wallets.releaseEscrowWithin.mockRejectedValueOnce(new Error('wallet down'));

    await expect(service.run(NOW)).resolves.toBe(1);

    expect(repository.manager.transaction).toHaveBeenCalledTimes(2);
    expect(fine.status).toBe(TransactionStatus.Canceled);
  });

  it('repeats while batches come back full', async () => {
    const rows = Array.from({ length: 150 }, (_, index) => deal(index + 1));
    const { service, repository } = build(rows);

    await expect(service.run(NOW)).resolves.toBe(150);

    expect(repository.find).toHaveBeenCalledTimes(2);
    expect(rows.every((row) => row.status === TransactionStatus.Canceled)).toBe(
      true,
    );
  });

  it('moves past a full batch that cancels nothing instead of re-reading it', async () => {
    const rows = Array.from({ length: 100 }, (_, index) => deal(index + 1));
    const { service, repository, lockedElsewhere } = build(rows);
    rows.forEach((row) => lockedElsewhere.add(row.id));

    await expect(service.run(NOW)).resolves.toBe(0);

    expect(repository.find).toHaveBeenCalledTimes(2);
    const [, second] = repository.find.mock.calls.map(([options]) => options);
    expect(second.where).toEqual([
      {
        status: In(TICKING),
        expiresAt: And(MoreThan(PAST), LessThanOrEqual(NOW)),
      },
      {
        status: In(TICKING),
        expiresAt: Equal(PAST),
        id: MoreThan(uuidOf(100)),
      },
    ]);
  });

  it('cancels a valid deal queued behind a full batch of permanently failing ones', async () => {
    const failing = Array.from({ length: 100 }, (_, index) => deal(index + 1));
    const valid = deal(101, { traderUserId: uuidOf(2) });
    const { service, wallets } = build([...failing, valid]);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    wallets.releaseEscrowWithin.mockImplementation(
      async (_manager: unknown, userId: string) => {
        if (userId === uuidOf(1)) throw new Error('wallet broken');
      },
    );

    await expect(service.run(NOW)).resolves.toBe(1);

    expect(valid.status).toBe(TransactionStatus.Canceled);
  });

  it('pages on the deadline before the id', async () => {
    const later = deal(1, { expiresAt: PAST });
    const earlier = Array.from({ length: 100 }, (_, index) =>
      deal(index + 2, { expiresAt: new Date(PAST.getTime() - 1000) }),
    );
    const { service } = build([later, ...earlier]);

    await expect(service.run(NOW)).resolves.toBe(101);
    expect(later.status).toBe(TransactionStatus.Canceled);
  });

  it('does not start a second run while one is in progress', async () => {
    const { service, repository } = build([deal(1)]);

    const [first, second] = await Promise.all([
      service.run(NOW),
      service.run(NOW),
    ]);

    expect(first).toBe(1);
    expect(second).toBe(0);
    expect(repository.find).toHaveBeenCalledTimes(1);
  });

  it('logs and survives a failing selection', async () => {
    const { service, repository } = build([deal(1)]);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    repository.find.mockRejectedValueOnce(new Error('db down'));

    await expect(service.run(NOW)).resolves.toBe(0);
    await expect(service.run(NOW)).resolves.toBe(1);
  });

  describe('the timer', () => {
    beforeEach(() => {
      jest.useFakeTimers({ now: NOW });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('runs every DEAL_EXPIRY_INTERVAL_SECONDS once the module starts, and stops with it', () => {
      const { service } = build([]);
      const run = jest.spyOn(service, 'run').mockResolvedValue(0);

      service.onModuleInit();
      jest.advanceTimersByTime(29_999);
      expect(run).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);
      expect(run).toHaveBeenCalledTimes(1);

      service.onModuleDestroy();
      jest.advanceTimersByTime(60_000);
      expect(run).toHaveBeenCalledTimes(1);
    });
  });
});
