import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { In } from 'typeorm';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { TraderLead } from '../../users/entities/trader-lead.entity';
import { Transaction } from '../entities/transaction.entity';
import { TransactionLeadShare } from '../entities/transaction-lead-share.entity';
import { TransactionService } from '../services/transaction.service';
import { CreateDealInput } from '../types/create-deal-input';
import { StatusEventSource } from '../types/status-event-source.enum';
import { TransactionKind } from '../types/transaction-kind.enum';
import { TransactionListQuery } from '../types/transaction-list-query';
import { TransactionSortField } from '../types/transaction-sort-field.enum';
import { TransactionStatus } from '../types/transaction-status.enum';

jest.mock('../utils/find-transaction-method', () => {
  const actual = jest.requireActual<
    typeof import('../utils/find-transaction-method')
  >('../utils/find-transaction-method');

  return {
    findTransactionMethod: (code: string) =>
      code === 'strict_sbp'
        ? {
            code,
            currency: 'RUB',
            rateKind: 'by_amount',
            platformMinPercent: 2,
          }
        : actual.findTransactionMethod(code),
  };
});

const TRADER = uuidOf(1);
const LEAD_A = uuidOf(21);
const LEAD_B = uuidOf(22);
const ENV_PLATFORM_MIN = 1;
const DEAL_TTL_MINUTES = 20;

const build = () => {
  const saved: unknown[] = [];
  const manager = {
    create: jest.fn((entity: unknown, data: Record<string, unknown>) =>
      entity === Transaction ? { ...data, id: uuidOf(50) } : { ...data },
    ),
    save: jest.fn(async (row: unknown) => {
      saved.push(row);
      return row;
    }),
    find: jest.fn(async (): Promise<unknown[]> => []),
    findOne: jest.fn(async (): Promise<unknown> => null),
  };
  const dataSource = {
    transaction: jest.fn(
      async (work: (entityManager: typeof manager) => unknown) => work(manager),
    ),
  };
  const wallets = {
    reserveMainEscrowWithin: jest.fn<Promise<void>, [unknown, string, number]>(
      async () => undefined,
    ),
    lockWalletsWithin: jest.fn(async () => undefined),
    debitMainWithin: jest.fn(async () => undefined),
    creditMainWithin: jest.fn(async () => undefined),
    releaseEscrowWithin: jest.fn(async () => undefined),
    creditLeadShareWithin: jest.fn(async () => undefined),
  };
  const rates = {
    resolveLeadPercents: jest.fn(
      async (): Promise<{ leadUserId: string; percent: number }[]> => [],
    ),
  };
  const links = [{ id: 70, leadUserId: LEAD_A } as TraderLead];
  const team = { assignmentsOf: jest.fn(async () => links) };
  const config = {
    getOrThrow: jest.fn((key: string) =>
      key === 'PLATFORM_MIN_PERCENT'
        ? ENV_PLATFORM_MIN
        : key === 'DEAL_TTL_MINUTES'
          ? DEAL_TTL_MINUTES
          : undefined,
    ),
  };

  const service = new TransactionService(
    dataSource as never,
    {} as never,
    wallets as never,
    {} as never,
    rates as never,
    team as never,
    config as never,
  );

  return {
    service,
    manager,
    dataSource,
    wallets,
    rates,
    team,
    links,
    config,
    saved,
  };
};

const input = (overrides: Partial<CreateDealInput> = {}): CreateDealInput =>
  ({
    kind: TransactionKind.PayIn,
    method: 'sbp',
    traderUserId: TRADER,
    bankDetailsId: uuidOf(2),
    merchantId: uuidOf(3),
    amountFiat: 10000,
    rate: 100,
    merchantPercent: 10,
    traderPercent: 7,
    ...overrides,
  }) as CreateDealInput;

describe('TransactionService.createDeal', () => {
  it('refuses a method the registry does not know, before touching any balance', async () => {
    const { service, wallets, dataSource, team } = build();

    await expect(
      service.createDeal(input({ method: 'qr' as never })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(team.assignmentsOf).not.toHaveBeenCalled();
    expect(wallets.reserveMainEscrowWithin).not.toHaveBeenCalled();
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('stores the method code of a registered method as it was given', async () => {
    const { service } = build();

    const created = await service.createDeal(
      input({ kind: TransactionKind.PayOut, method: 'mobile_commerce' }),
    );

    expect(created.method).toBe('mobile_commerce');
  });

  it('resolves the lead rates from the trader’s assignments, not from the caller', async () => {
    const { service, rates, team, links } = build();

    await service.createDeal(input({ amountFiat: 2500, bankId: 4 }));

    expect(team.assignmentsOf).toHaveBeenCalledWith(TRADER);
    expect(rates.resolveLeadPercents).toHaveBeenCalledWith({
      links,
      method: 'sbp',
      amount: 2500,
      bankId: 4,
      direction: 'payIn',
    });
  });

  it('resolves pay-out lead rates in the pay-out direction', async () => {
    const { service, rates } = build();

    await service.createDeal(input({ kind: TransactionKind.PayOut }));

    expect(rates.resolveLeadPercents).toHaveBeenCalledWith(
      expect.objectContaining({ direction: 'payOut', bankId: null }),
    );
  });

  it('prices the owner example 10 / 7 / 2.5 / 1 and stores the effective trader rate and the lead share', async () => {
    const { service, rates, manager } = build();
    rates.resolveLeadPercents.mockResolvedValue([
      { leadUserId: LEAD_A, percent: 2.5 },
    ]);

    const created = await service.createDeal(input());

    expect(created.traderPercent).toBe(7);
    expect(created.traderEffectivePercent).toBe(6.5);
    expect(created.leadPercent).toBe(2.5);
    expect(created.leadCommission).toBe(2.5);
    expect(manager.create).toHaveBeenCalledWith(TransactionLeadShare, {
      transactionId: uuidOf(50),
      leadUserId: LEAD_A,
      percent: 2.5,
      amount: 2.5,
    });
  });

  it('stores one share per lead and their sum on the deal', async () => {
    const { service, rates, manager } = build();
    rates.resolveLeadPercents.mockResolvedValue([
      { leadUserId: LEAD_A, percent: 1 },
      { leadUserId: LEAD_B, percent: 0.5 },
    ]);

    const created = await service.createDeal(input());

    const shares = manager.create.mock.calls
      .filter(([entity]) => entity === TransactionLeadShare)
      .map(([, data]) => data);

    expect(shares).toEqual([
      { transactionId: uuidOf(50), leadUserId: LEAD_A, percent: 1, amount: 1 },
      {
        transactionId: uuidOf(50),
        leadUserId: LEAD_B,
        percent: 0.5,
        amount: 0.5,
      },
    ]);
    expect(created.leadPercent).toBe(1.5);
    expect(created.traderEffectivePercent).toBe(7);
  });

  it('writes no share row and leaves the lead columns null for a trader with no lead', async () => {
    const { service, manager } = build();

    const created = await service.createDeal(input());

    expect(created.leadPercent).toBeNull();
    expect(created.leadCommission).toBeNull();
    expect(
      manager.create.mock.calls.some(
        ([entity]) => entity === TransactionLeadShare,
      ),
    ).toBe(false);
  });

  it('takes the platform minimum from the environment', async () => {
    const { service, rates, config } = build();
    rates.resolveLeadPercents.mockResolvedValue([
      { leadUserId: LEAD_A, percent: 2.5 },
    ]);

    const created = await service.createDeal(input());

    expect(config.getOrThrow).toHaveBeenCalledWith('PLATFORM_MIN_PERCENT');
    expect(created.traderEffectivePercent).toBe(6.5);
  });

  it('lets a method of the registry override the platform minimum', async () => {
    const { service, rates, config } = build();
    rates.resolveLeadPercents.mockResolvedValue([
      { leadUserId: LEAD_A, percent: 2.5 },
    ]);

    const created = await service.createDeal(
      input({ method: 'strict_sbp' as never }),
    );

    expect(config.getOrThrow).not.toHaveBeenCalledWith('PLATFORM_MIN_PERCENT');
    expect(created.traderEffectivePercent).toBe(5.5);
  });

  it.each([TransactionKind.PayIn, TransactionKind.PayOut] as const)(
    'refuses a %s whose shortfall exceeds the trader rate: no escrow, nothing written',
    async (kind) => {
      const { service, rates, wallets, dataSource } = build();
      rates.resolveLeadPercents.mockResolvedValue([
        { leadUserId: LEAD_A, percent: 9.5 },
      ]);

      await expect(
        service.createDeal(input({ kind, traderPercent: 2 })),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(wallets.reserveMainEscrowWithin).not.toHaveBeenCalled();
      expect(dataSource.transaction).not.toHaveBeenCalled();
    },
  );

  it('reserves the pay-in escrow at the effective trader rate', async () => {
    const { service, rates, wallets, manager } = build();
    rates.resolveLeadPercents.mockResolvedValue([
      { leadUserId: LEAD_A, percent: 2.5 },
    ]);

    await service.createDeal(input());

    expect(wallets.reserveMainEscrowWithin).toHaveBeenCalledWith(
      manager,
      TRADER,
      93.897,
    );
  });

  const withRollback = (built: ReturnType<typeof build>) => {
    const wallet = { mainReserved: 0 };
    built.wallets.reserveMainEscrowWithin.mockImplementation(
      async (_manager: unknown, _userId: string, amount: number) => {
        wallet.mainReserved += amount;
      },
    );
    built.dataSource.transaction.mockImplementation(async (work) => {
      const before = wallet.mainReserved;
      try {
        return await work(built.manager);
      } catch (error) {
        wallet.mainReserved = before;
        throw error;
      }
    });
    return wallet;
  };

  it('reserves the pay-in escrow in the transaction that inserts the deal, before the insert', async () => {
    const built = build();
    const wallet = withRollback(built);
    built.rates.resolveLeadPercents.mockResolvedValue([
      { leadUserId: LEAD_A, percent: 2.5 },
    ]);

    await built.service.createDeal(input());

    expect(built.dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(wallet.mainReserved).toBe(93.897);
    expect(
      built.wallets.reserveMainEscrowWithin.mock.invocationCallOrder[0],
    ).toBeLessThan(built.manager.save.mock.invocationCallOrder[0]);
  });

  it('rolls the reservation back with a failing insert', async () => {
    const built = build();
    const wallet = withRollback(built);
    built.manager.save.mockRejectedValueOnce(new Error('insert failed'));

    await expect(built.service.createDeal(input())).rejects.toThrow(
      'insert failed',
    );
    expect(built.wallets.reserveMainEscrowWithin).toHaveBeenCalledTimes(1);
    expect(wallet.mainReserved).toBe(0);
  });

  it('reserves nothing for a pay-out', async () => {
    const { service, wallets } = build();

    await service.createDeal(input({ kind: TransactionKind.PayOut }));

    expect(wallets.reserveMainEscrowWithin).not.toHaveBeenCalled();
  });
});

describe('TransactionService.transition, settling lead shares', () => {
  const deal = (overrides: Partial<Transaction> = {}): Transaction =>
    ({
      id: uuidOf(50),
      kind: TransactionKind.PayIn,
      status: TransactionStatus.Active,
      traderUserId: TRADER,
      traderAmount: 93.897,
      ...overrides,
    }) as Transaction;

  const share = (leadUserId: string, amount: number) =>
    ({
      transactionId: uuidOf(50),
      leadUserId,
      percent: amount,
      amount,
    }) as TransactionLeadShare;

  const settle = async (
    transaction: Transaction,
    toStatus: TransactionStatus,
    shares: TransactionLeadShare[],
  ) => {
    const built = build();
    built.manager.findOne.mockResolvedValue(transaction);
    built.manager.find.mockResolvedValue(shares);

    await built.service.transition(transaction.id, {
      toStatus,
      source: StatusEventSource.System,
    });

    return built;
  };

  it.each([TransactionStatus.Success, TransactionStatus.SuccessChanged])(
    'credits every lead its share on %s, in the settling transaction',
    async (toStatus) => {
      const { wallets, manager, dataSource } = await settle(
        deal({
          status:
            toStatus === TransactionStatus.SuccessChanged
              ? TransactionStatus.ManualReview
              : TransactionStatus.Active,
        }),
        toStatus,
        [share(LEAD_A, 2.5), share(LEAD_B, 1)],
      );

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(manager.find).toHaveBeenCalledWith(TransactionLeadShare, {
        where: { transactionId: uuidOf(50) },
        order: { id: 'ASC' },
      });
      expect(wallets.creditLeadShareWithin).toHaveBeenCalledTimes(2);
      expect(wallets.creditLeadShareWithin).toHaveBeenCalledWith(
        manager,
        LEAD_A,
        2.5,
        uuidOf(50),
      );
      expect(wallets.creditLeadShareWithin).toHaveBeenCalledWith(
        manager,
        LEAD_B,
        1,
        uuidOf(50),
      );
      expect(wallets.debitMainWithin).toHaveBeenCalled();
    },
  );

  it.each([TransactionKind.PayIn, TransactionKind.PayOut])(
    'locks the trader and every lead with a share before moving money on a %s',
    async (kind) => {
      const { wallets, manager } = await settle(
        deal({ kind, status: TransactionStatus.Active }),
        TransactionStatus.Success,
        [share(LEAD_B, 1), share(uuidOf(23), 0), share(LEAD_A, 2.5)],
      );

      expect(wallets.lockWalletsWithin).toHaveBeenCalledTimes(1);
      expect(wallets.lockWalletsWithin).toHaveBeenCalledWith(
        manager,
        [TRADER, LEAD_B, LEAD_A],
        [LEAD_B, LEAD_A],
      );
      const lockedAt = wallets.lockWalletsWithin.mock.invocationCallOrder[0];
      const moves = [
        ...wallets.creditLeadShareWithin.mock.invocationCallOrder,
        ...wallets.debitMainWithin.mock.invocationCallOrder,
        ...wallets.creditMainWithin.mock.invocationCallOrder,
      ];
      expect(moves.length).toBeGreaterThan(0);
      expect(moves.every((order) => order > lockedAt)).toBe(true);
    },
  );

  it('credits nothing when a deal already success is settled again', async () => {
    const { wallets, manager } = await settle(
      deal({ status: TransactionStatus.Success }),
      TransactionStatus.Success,
      [share(LEAD_A, 2.5)],
    );

    expect(manager.find).not.toHaveBeenCalled();
    expect(wallets.lockWalletsWithin).not.toHaveBeenCalled();
    expect(wallets.creditLeadShareWithin).not.toHaveBeenCalled();
    expect(wallets.debitMainWithin).not.toHaveBeenCalled();
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('refuses success_changed → success with a 409 and credits nothing', async () => {
    const built = build();
    built.manager.findOne.mockResolvedValue(
      deal({ status: TransactionStatus.SuccessChanged }),
    );
    built.manager.find.mockResolvedValue([share(LEAD_A, 2.5)]);

    await expect(
      built.service.transition(uuidOf(50), {
        toStatus: TransactionStatus.Success,
        source: StatusEventSource.Admin,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(built.wallets.creditLeadShareWithin).not.toHaveBeenCalled();
    expect(built.wallets.debitMainWithin).not.toHaveBeenCalled();
    expect(built.manager.save).not.toHaveBeenCalled();
  });

  it('credits the leads of a successful pay-out as well', async () => {
    const { wallets } = await settle(
      deal({ kind: TransactionKind.PayOut, status: TransactionStatus.Active }),
      TransactionStatus.Success,
      [share(LEAD_A, 0.5)],
    );

    expect(wallets.creditLeadShareWithin).toHaveBeenCalledTimes(1);
    expect(wallets.creditMainWithin).toHaveBeenCalled();
  });

  it('credits nothing to a lead when the deal is canceled', async () => {
    const { wallets, manager } = await settle(
      deal(),
      TransactionStatus.Canceled,
      [share(LEAD_A, 2.5)],
    );

    expect(manager.find).not.toHaveBeenCalled();
    expect(wallets.creditLeadShareWithin).not.toHaveBeenCalled();
    expect(wallets.releaseEscrowWithin).toHaveBeenCalled();
    expect(wallets.lockWalletsWithin).not.toHaveBeenCalled();
  });

  it('writes no journal row for a zero share', async () => {
    const { wallets } = await settle(deal(), TransactionStatus.Success, [
      share(LEAD_A, 0),
    ]);

    expect(wallets.creditLeadShareWithin).not.toHaveBeenCalled();
  });

  it('credits nothing on a non-final step', async () => {
    const { wallets, manager } = await settle(
      deal(),
      TransactionStatus.Checking,
      [share(LEAD_A, 2.5)],
    );

    expect(manager.find).not.toHaveBeenCalled();
    expect(wallets.creditLeadShareWithin).not.toHaveBeenCalled();
  });
});

describe('TransactionService.createDeal, the deadline', () => {
  const NOW = new Date('2026-10-24T12:00:00.000Z');

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it.each([TransactionKind.PayIn, TransactionKind.PayOut] as const)(
    'stamps a %s deal with the creation moment and that moment plus DEAL_TTL_MINUTES',
    async (kind) => {
      const { service, config } = build();

      const created = await service.createDeal(input({ kind }));

      expect(config.getOrThrow).toHaveBeenCalledWith('DEAL_TTL_MINUTES');
      expect(created.createdAt).toEqual(NOW);
      expect(created.expiresAt).toEqual(
        new Date(NOW.getTime() + DEAL_TTL_MINUTES * 60_000),
      );
    },
  );

  it('fails before reserving anything when DEAL_TTL_MINUTES is missing', async () => {
    const { service, config, wallets } = build();
    config.getOrThrow.mockImplementation((key: string) => {
      if (key === 'DEAL_TTL_MINUTES') throw new Error('DEAL_TTL_MINUTES');

      return key === 'PLATFORM_MIN_PERCENT' ? ENV_PLATFORM_MIN : undefined;
    });

    await expect(service.createDeal(input())).rejects.toThrow(
      'DEAL_TTL_MINUTES',
    );
    expect(wallets.reserveMainEscrowWithin).not.toHaveBeenCalled();
  });
});

describe('TransactionService.transition, the deadline', () => {
  const EXPIRES_AT = new Date('2026-10-24T12:20:00.000Z');

  const deal = (status: TransactionStatus): Transaction =>
    ({
      id: uuidOf(50),
      kind: TransactionKind.PayIn,
      status,
      traderUserId: TRADER,
      traderAmount: 10,
      createdAt: new Date('2026-10-24T12:00:00.000Z'),
      expiresAt: EXPIRES_AT,
    }) as Transaction;

  it('keeps expiresAt through a dispute and through the pay-out round trip active → pending → active', async () => {
    const built = build();
    const row = deal(TransactionStatus.Active);
    built.manager.findOne.mockResolvedValue(row);

    await built.service.transition(row.id, {
      toStatus: TransactionStatus.Dispute,
      source: StatusEventSource.Admin,
    });
    expect(row.expiresAt).toBe(EXPIRES_AT);

    const payOut = {
      ...deal(TransactionStatus.Active),
      kind: TransactionKind.PayOut,
    } as Transaction;
    built.manager.findOne.mockResolvedValue(payOut);

    await built.service.transition(payOut.id, {
      toStatus: TransactionStatus.Pending,
      source: StatusEventSource.Trader,
    });
    await built.service.transition(payOut.id, {
      toStatus: TransactionStatus.Active,
      source: StatusEventSource.Trader,
    });

    expect(payOut.expiresAt).toBe(EXPIRES_AT);
    expect(
      built.saved
        .filter(
          (row): row is Transaction => (row as Transaction).kind !== undefined,
        )
        .every((row) => row.expiresAt === EXPIRES_AT),
    ).toBe(true);
  });

  it('locks the row it transitions, and answers 404 for an unknown id', async () => {
    const built = build();

    await expect(
      built.service.transition(uuidOf(99), {
        toStatus: TransactionStatus.Canceled,
        source: StatusEventSource.Admin,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(built.manager.findOne).toHaveBeenCalledWith(Transaction, {
      where: { id: uuidOf(99) },
      lock: { mode: 'pessimistic_write' },
    });
  });
});

describe('TransactionService.transitionLocked', () => {
  const lockedDeal = (overrides: Partial<Transaction> = {}): Transaction =>
    ({
      id: uuidOf(50),
      kind: TransactionKind.PayIn,
      status: TransactionStatus.Active,
      traderUserId: TRADER,
      traderAmount: 93.897,
      ...overrides,
    }) as Transaction;

  it('cancels through the caller’s transaction, releasing the pay-in escrow and writing the event', async () => {
    const built = build();
    const row = lockedDeal();

    const result = await built.service.transitionLocked(
      built.manager as never,
      row,
      {
        toStatus: TransactionStatus.Canceled,
        source: StatusEventSource.AutoTimer,
        actorUserId: null,
        reason: 'expired',
      },
    );

    expect(built.dataSource.transaction).not.toHaveBeenCalled();
    expect(result.status).toBe(TransactionStatus.Canceled);
    expect(result.resolvedAt).toBeInstanceOf(Date);
    expect(built.wallets.releaseEscrowWithin).toHaveBeenCalledWith(
      built.manager,
      TRADER,
      93.897,
    );
    expect(built.saved).toContainEqual(
      expect.objectContaining({
        transactionId: uuidOf(50),
        fromStatus: TransactionStatus.Active,
        toStatus: TransactionStatus.Canceled,
        source: StatusEventSource.AutoTimer,
        actorUserId: null,
        reason: 'expired',
      }),
    );
  });

  it('refuses an illegal step with a 409 and writes nothing', async () => {
    const built = build();

    await expect(
      built.service.transitionLocked(
        built.manager as never,
        lockedDeal({ status: TransactionStatus.Dispute }),
        {
          toStatus: TransactionStatus.Canceled,
          source: StatusEventSource.AutoTimer,
        },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(built.saved).toEqual([]);
    expect(built.wallets.releaseEscrowWithin).not.toHaveBeenCalled();
  });
});

describe('TransactionService.list', () => {
  const query = (
    overrides: Partial<TransactionListQuery> = {},
  ): TransactionListQuery => ({
    page: 2,
    limit: 10,
    sortBy: TransactionSortField.CreatedAt,
    sortOrder: SortOrder.Desc,
    ...overrides,
  });

  const buildList = () => {
    const rows = [{ id: uuidOf(60) } as Transaction];
    const builder = {
      setFindOptions: jest.fn(() => builder),
      orderBy: jest.fn(() => builder),
      addOrderBy: jest.fn(() => builder),
      setParameters: jest.fn(() => builder),
      skip: jest.fn(() => builder),
      take: jest.fn(() => builder),
      getManyAndCount: jest.fn(async () => [rows, 31]),
    };
    const repository = {
      findAndCount: jest.fn(async () => [rows, 31]),
      createQueryBuilder: jest.fn(() => builder),
    };
    const service = new TransactionService(
      {} as never,
      repository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    return { service, repository, builder, rows };
  };

  it('pages with the where and the order of the list helpers', async () => {
    const { service, repository, rows } = buildList();

    const page = await service.list(
      query({ amountFrom: 100, sortBy: TransactionSortField.AmountFiat }),
    );

    expect(repository.findAndCount).toHaveBeenCalledWith({
      where: { amountFiat: expect.anything() },
      order: { amountFiat: 'DESC', id: 'DESC' },
      skip: 10,
      take: 10,
    });
    expect(page.items).toBe(rows);
    expect(page.meta).toEqual({ total: 31, page: 2, limit: 10, pages: 4 });
  });

  it('filters by the requisites it was handed inside the query', async () => {
    const { service, repository } = buildList();

    await service.list(query({ bankDetailsIds: [uuidOf(10), uuidOf(11)] }));

    expect(repository.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { bankDetailsId: In([uuidOf(10), uuidOf(11)]) },
      }),
    );
  });

  it('answers an empty page without querying when the bank has no requisites', async () => {
    const { service, repository } = buildList();

    const page = await service.list(query({ bankDetailsIds: [] }));

    expect(repository.findAndCount).not.toHaveBeenCalled();
    expect(repository.createQueryBuilder).not.toHaveBeenCalled();
    expect(page.items).toEqual([]);
    expect(page.meta.total).toBe(0);
  });

  it('orders by the merchant’s name rank in SQL, then by id, in the same direction', async () => {
    const { service, repository, builder, rows } = buildList();
    const merchantRanks = new Map([
      [uuidOf(3), 0],
      [uuidOf(4), 1],
      [uuidOf(5), 1],
    ]);

    const page = await service.list(
      query({
        sortBy: TransactionSortField.Merchant,
        sortOrder: SortOrder.Asc,
        merchantId: uuidOf(4),
        merchantRanks,
      }),
    );

    expect(repository.findAndCount).not.toHaveBeenCalled();
    expect(builder.setFindOptions).toHaveBeenCalledWith({
      where: { merchantId: uuidOf(4) },
    });
    expect(builder.orderBy).toHaveBeenCalledWith(
      expect.stringContaining('transaction.merchantId'),
      'ASC',
      'NULLS LAST',
    );
    expect(builder.addOrderBy).toHaveBeenCalledWith('transaction.id', 'ASC');
    expect(builder.setParameters).toHaveBeenCalledWith({
      merchantRankIds: [uuidOf(3), uuidOf(4), uuidOf(5)],
      merchantRankValues: [0, 1, 1],
    });
    expect(builder.skip).toHaveBeenCalledWith(10);
    expect(builder.take).toHaveBeenCalledWith(10);
    expect(page.items).toBe(rows);
    expect(page.meta.total).toBe(31);
  });

  it('puts deals without a merchant first when sorting by merchant descending', async () => {
    const { service, builder } = buildList();

    await service.list(
      query({
        sortBy: TransactionSortField.Merchant,
        sortOrder: SortOrder.Desc,
        merchantRanks: new Map(),
      }),
    );

    expect(builder.orderBy).toHaveBeenCalledWith(
      expect.any(String),
      'DESC',
      'NULLS FIRST',
    );
    expect(builder.setParameters).toHaveBeenCalledWith({
      merchantRankIds: [],
      merchantRankValues: [],
    });
  });
});
