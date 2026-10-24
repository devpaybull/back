import { BadRequestException, ConflictException } from '@nestjs/common';
import { In, MoreThanOrEqual } from 'typeorm';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { TraderSettings } from '../../trader-settings/entities/trader-settings.entity';
import { TraderSettingsService } from '../../trader-settings/trader-settings.service';
import { BalanceOperation } from '../entities/balance-operation.entity';
import { Wallet } from '../entities/wallet.entity';
import { WalletService } from '../services/wallet.service';
import { BalanceKind } from '../types/balance-kind.enum';
import { BalanceOperationType } from '../types/balance-operation-type.enum';

describe('WalletService.hasMinInsurancePayIn', () => {
  const GLOBAL_MIN = 500;

  const build = (
    balance: number,
    personal: number | null,
    hasSettingsRow = true,
  ) => {
    const wallets = {
      findOne: jest.fn(
        async () => ({ insurancePayInBalance: balance }) as Wallet,
      ),
    };
    const settingsRepository = {
      findOne: jest.fn(async () =>
        !hasSettingsRow
          ? null
          : personal === null
            ? ({ insurancePayInMin: null } as TraderSettings)
            : ({ insurancePayInMin: personal } as TraderSettings),
      ),
    };
    const config = { get: jest.fn(() => GLOBAL_MIN) };
    const traderSettings = new TraderSettingsService(
      settingsRepository as never,
      {} as never,
      {} as never,
      config as never,
    );

    return new WalletService(
      wallets as never,
      {} as never,
      config as never,
      traderSettings,
    );
  };

  it('refuses a balance below a higher personal minimum', async () => {
    await expect(
      build(600, 1000).hasMinInsurancePayIn(uuidOf(1)),
    ).resolves.toBe(false);
  });

  it('accepts a balance above a lower personal minimum', async () => {
    await expect(build(200, 100).hasMinInsurancePayIn(uuidOf(1))).resolves.toBe(
      true,
    );
  });

  it('falls back to the global minimum without a personal one', async () => {
    await expect(
      build(400, null).hasMinInsurancePayIn(uuidOf(1)),
    ).resolves.toBe(false);
    await expect(
      build(500, null).hasMinInsurancePayIn(uuidOf(1)),
    ).resolves.toBe(true);
  });

  it('uses the global minimum when the account has no settings row', async () => {
    await expect(
      build(400, null, false).hasMinInsurancePayIn(uuidOf(1)),
    ).resolves.toBe(false);
    await expect(
      build(500, null, false).hasMinInsurancePayIn(uuidOf(1)),
    ).resolves.toBe(true);
  });

  it('accepts a zero balance against a personal minimum of zero', async () => {
    await expect(build(0, 0).hasMinInsurancePayIn(uuidOf(1))).resolves.toBe(
      true,
    );
  });
});

describe('WalletService.findByUserIds', () => {
  const build = () => {
    const wallets = {
      find: jest.fn(async () => [{ userId: uuidOf(1) } as Wallet]),
    };

    return {
      wallets,
      service: new WalletService(
        wallets as never,
        {} as never,
        {} as never,
        {} as never,
      ),
    };
  };

  it('reads every wallet of the given accounts in one query', async () => {
    const { wallets, service } = build();

    await expect(
      service.findByUserIds([uuidOf(1), uuidOf(2)]),
    ).resolves.toEqual([{ userId: uuidOf(1) }]);
    expect(wallets.find).toHaveBeenCalledTimes(1);
    expect(wallets.find).toHaveBeenCalledWith({
      where: { userId: In([uuidOf(1), uuidOf(2)]) },
    });
  });

  it('asks nothing for an empty list', async () => {
    const { wallets, service } = build();

    await expect(service.findByUserIds([])).resolves.toEqual([]);
    expect(wallets.find).not.toHaveBeenCalled();
  });
});

describe('WalletService.creditLeadShareWithin', () => {
  const build = (wallet: Partial<Wallet>) => {
    const insert = {
      insert: jest.fn(),
      into: jest.fn(),
      values: jest.fn(),
      orIgnore: jest.fn(),
      execute: jest.fn(async () => undefined),
    };
    insert.insert.mockReturnValue(insert);
    insert.into.mockReturnValue(insert);
    insert.values.mockReturnValue(insert);
    insert.orIgnore.mockReturnValue(insert);
    const manager = {
      createQueryBuilder: jest.fn(() => insert),
      findOne: jest.fn(async () => wallet as Wallet),
      create: jest.fn((_entity: unknown, data: unknown) => data),
      save: jest.fn(async (row: unknown) => row),
    };
    const service = new WalletService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    return { service, manager, insert };
  };

  it('makes sure the lead has a wallet without failing on one that exists', async () => {
    const { service, manager, insert } = build({ id: 4, mainBalance: 10 });

    await service.creditLeadShareWithin(
      manager as never,
      uuidOf(21),
      2.5,
      uuidOf(50),
    );

    expect(insert.into).toHaveBeenCalledWith(Wallet);
    expect(insert.values).toHaveBeenCalledWith({ userId: uuidOf(21) });
    expect(insert.orIgnore).toHaveBeenCalled();
    expect(insert.execute).toHaveBeenCalled();
  });

  it('credits the main balance under a lock and journals it against the deal', async () => {
    const wallet = { id: 4, userId: uuidOf(21), mainBalance: 10 };
    const { service, manager } = build(wallet);

    await service.creditLeadShareWithin(
      manager as never,
      uuidOf(21),
      2.5,
      uuidOf(50),
    );

    expect(manager.findOne).toHaveBeenCalledWith(Wallet, {
      where: { userId: uuidOf(21) },
      lock: { mode: 'pessimistic_write' },
    });
    expect(wallet.mainBalance).toBe(12.5);
    expect(manager.create).toHaveBeenCalledWith(BalanceOperation, {
      walletId: 4,
      type: BalanceOperationType.Transaction,
      balanceKind: BalanceKind.Main,
      transactionId: uuidOf(50),
      amount: 2.5,
      balanceBefore: 10,
      balanceAfter: 12.5,
    });
  });
});

describe('WalletService debt movements', () => {
  const build = (wallets: Partial<Wallet>[]) => {
    const insert = {
      insert: jest.fn(),
      into: jest.fn(),
      values: jest.fn(),
      orIgnore: jest.fn(),
      execute: jest.fn(async () => undefined),
    };
    insert.insert.mockReturnValue(insert);
    insert.into.mockReturnValue(insert);
    insert.values.mockReturnValue(insert);
    insert.orIgnore.mockReturnValue(insert);
    const manager = {
      createQueryBuilder: jest.fn(() => insert),
      findOne: jest.fn(
        async (_entity: unknown, options: { where: { userId: string } }) =>
          (wallets.find((wallet) => wallet.userId === options.where.userId) ??
            null) as Wallet | null,
      ),
      create: jest.fn((_entity: unknown, data: object) => ({ ...data })),
      save: jest.fn(async (row: unknown) =>
        Array.isArray(row) ? row : { id: 77, ...(row as object) },
      ),
    };
    const service = new WalletService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    return { service, manager, insert };
  };

  it('credits an issued debt to the main balance, creating the wallet if missing, and returns the saved journal row', async () => {
    const wallet = { id: 4, userId: uuidOf(1), mainBalance: 10 };
    const { service, manager, insert } = build([wallet]);

    const operation = await service.creditDebtWithin(
      manager as never,
      uuidOf(1),
      400,
    );

    expect(insert.into).toHaveBeenCalledWith(Wallet);
    expect(insert.values).toHaveBeenCalledWith({ userId: uuidOf(1) });
    expect(insert.orIgnore).toHaveBeenCalled();
    expect(manager.findOne).toHaveBeenCalledWith(Wallet, {
      where: { userId: uuidOf(1) },
      lock: { mode: 'pessimistic_write' },
    });
    expect(wallet.mainBalance).toBe(410);
    expect(manager.create).toHaveBeenCalledWith(BalanceOperation, {
      walletId: 4,
      type: BalanceOperationType.DebtIssued,
      balanceKind: BalanceKind.Main,
      transactionId: null,
      amount: 400,
      balanceBefore: 10,
      balanceAfter: 410,
    });
    expect(operation.id).toBe(77);
  });

  it('withholds a write-off from the main balance even when it goes negative', async () => {
    const wallet = { id: 4, userId: uuidOf(1), mainBalance: 50 };
    const { service, manager } = build([wallet]);

    await service.debitDebtWithin(manager as never, uuidOf(1), 120.5);

    expect(wallet.mainBalance).toBe(-70.5);
    expect(manager.create).toHaveBeenCalledWith(BalanceOperation, {
      walletId: 4,
      type: BalanceOperationType.DebtWriteOff,
      balanceKind: BalanceKind.Main,
      transactionId: null,
      amount: -120.5,
      balanceBefore: 50,
      balanceAfter: -70.5,
    });
  });

  it('reports a negative available balance for a wallet in the red', () => {
    const { service } = build([]);

    expect(
      service.getAvailableMain({
        mainBalance: -70.5,
        mainReserved: 0,
      } as Wallet),
    ).toBe(-70.5);
  });

  it('refuses a transfer out of a wallet whose main balance is negative', async () => {
    const from = { id: 1, userId: uuidOf(1), mainBalance: -5, mainReserved: 0 };
    const to = { id: 2, userId: uuidOf(2), mainBalance: 0, mainReserved: 0 };
    const { service, manager } = build([from, to]);

    await expect(
      service.transferWithin(
        manager as never,
        uuidOf(1),
        uuidOf(2),
        1,
        uuidOf(50),
      ),
    ).rejects.toThrow(ConflictException);
    expect(from.mainBalance).toBe(-5);
    expect(manager.save).not.toHaveBeenCalled();
  });
});

describe('WalletService.lockWalletsWithin', () => {
  const build = () => {
    const insert = {
      insert: jest.fn(),
      into: jest.fn(),
      values: jest.fn(),
      orIgnore: jest.fn(),
      execute: jest.fn(async () => undefined),
    };
    insert.insert.mockReturnValue(insert);
    insert.into.mockReturnValue(insert);
    insert.values.mockReturnValue(insert);
    insert.orIgnore.mockReturnValue(insert);
    const manager = {
      createQueryBuilder: jest.fn(() => insert),
      findOne: jest.fn(
        async (_entity: unknown, options: { where: { userId: string } }) =>
          ({ id: 1, userId: options.where.userId }) as Wallet,
      ),
    };
    const service = new WalletService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const lockedIds = () =>
      manager.findOne.mock.calls.map(([, options]) => options.where.userId);

    return { service, manager, insert, lockedIds };
  };

  it('locks every wallet once, in sorted userId order whatever order it was given', async () => {
    const { service, manager, lockedIds } = build();

    await service.lockWalletsWithin(
      manager as never,
      [uuidOf(5), uuidOf(22), uuidOf(1), uuidOf(21), uuidOf(22)],
      [],
    );

    expect(lockedIds()).toEqual([uuidOf(1), uuidOf(5), uuidOf(21), uuidOf(22)]);
    expect(manager.findOne).toHaveBeenCalledWith(Wallet, {
      where: { userId: uuidOf(1) },
      lock: { mode: 'pessimistic_write' },
    });
  });

  it('creates the missing wallets with ON CONFLICT DO NOTHING before locking any', async () => {
    const { service, manager, insert } = build();

    await service.lockWalletsWithin(
      manager as never,
      [uuidOf(1), uuidOf(22), uuidOf(21)],
      [uuidOf(22), uuidOf(21)],
    );

    expect(insert.values).toHaveBeenCalledWith([
      { userId: uuidOf(21) },
      { userId: uuidOf(22) },
    ]);
    expect(insert.orIgnore).toHaveBeenCalled();
    expect(insert.execute.mock.invocationCallOrder[0]).toBeLessThan(
      manager.findOne.mock.invocationCallOrder[0],
    );
  });

  it('inserts nothing when no wallet has to be created', async () => {
    const { service, manager } = build();

    await service.lockWalletsWithin(manager as never, [uuidOf(1)], []);

    expect(manager.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('takes the same order for a transfer', async () => {
    const { service, manager, lockedIds } = build();
    manager.findOne.mockImplementation(
      async (_entity: unknown, options: { where: { userId: string } }) =>
        ({
          id: 1,
          userId: options.where.userId,
          mainBalance: 0,
          mainReserved: 0,
        }) as Wallet,
    );

    await expect(
      service.transferWithin(
        manager as never,
        uuidOf(22),
        uuidOf(1),
        1,
        uuidOf(50),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(lockedIds()).toEqual([uuidOf(1), uuidOf(22)]);
  });
});

describe('WalletService with a negative main balance', () => {
  const inTheRed = {
    id: 1,
    userId: uuidOf(1),
    mainBalance: -5,
    mainReserved: 0,
  };

  it('refuses to reserve escrow', async () => {
    const wallet = { ...inTheRed };
    const manager = {
      findOne: jest.fn(async () => wallet),
      save: jest.fn(),
    };
    const service = new WalletService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.reserveMainEscrowWithin(manager as never, uuidOf(1), 1),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(wallet.mainReserved).toBe(0);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('reports trading as disabled', async () => {
    const service = new WalletService(
      { findOne: jest.fn(async () => ({ ...inTheRed })) } as never,
      {} as never,
      { get: jest.fn(() => 0) } as never,
      {} as never,
    );

    await expect(service.isTradingEnabled(uuidOf(1))).resolves.toBe(false);
  });
});

describe('WalletService balance journal', () => {
  const userId = uuidOf(1);
  const row = (id: number) => ({ id }) as BalanceOperation;

  const build = (wallet: Partial<Wallet> | null, rows: BalanceOperation[]) => {
    const journal = {
      findAndCount: jest.fn(
        async () => [rows, 42] as [BalanceOperation[], number],
      ),
      find: jest.fn(async () => rows),
    };
    const wallets = { findOne: jest.fn(async () => wallet as Wallet | null) };
    const dataSource = { getRepository: jest.fn(() => journal) };
    const service = new WalletService(
      wallets as never,
      dataSource as never,
      {} as never,
      {} as never,
    );

    return { service, journal, dataSource };
  };

  it('answers an empty page, not an error, for an account with no wallet', async () => {
    const { service, dataSource } = build(null, []);

    const page = await service.listOperations({
      userId,
      page: 1,
      limit: 20,
      sortOrder: SortOrder.Desc,
    });

    expect(page.items).toEqual([]);
    expect(page.meta).toEqual({ total: 0, page: 1, limit: 20, pages: 0 });
    expect(dataSource.getRepository).not.toHaveBeenCalled();
  });

  it('lists newest first with the id as tie-break, filtered in the query', async () => {
    const { service, journal, dataSource } = build({ id: 4 }, [row(2), row(1)]);
    const from = new Date('2026-10-01T00:00:00Z');

    const page = await service.listOperations({
      userId,
      from,
      types: [BalanceOperationType.Transaction],
      kind: BalanceKind.Main,
      page: 3,
      limit: 10,
      sortOrder: SortOrder.Asc,
    });

    expect(dataSource.getRepository).toHaveBeenCalledWith(BalanceOperation);
    expect(journal.findAndCount).toHaveBeenCalledWith({
      where: {
        walletId: 4,
        createdAt: MoreThanOrEqual(from),
        type: In([BalanceOperationType.Transaction]),
        balanceKind: BalanceKind.Main,
      },
      order: { createdAt: 'ASC', id: 'ASC' },
      skip: 20,
      take: 10,
    });
    expect(page.items).toHaveLength(2);
    expect(page.meta).toEqual({ total: 42, page: 3, limit: 10, pages: 5 });
  });

  it('exports an empty list for an account with no wallet', async () => {
    const { service } = build(null, []);

    await expect(service.exportOperations({ userId }, 5)).resolves.toEqual([]);
  });

  it('exports unpaginated, asking for one row beyond the cap', async () => {
    const { service, journal } = build({ id: 4 }, [row(2), row(1)]);

    await expect(service.exportOperations({ userId }, 5)).resolves.toHaveLength(
      2,
    );
    expect(journal.find).toHaveBeenCalledWith({
      where: { walletId: 4 },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: 6,
    });
  });

  it('allows exactly the cap and refuses one more with a 400', async () => {
    const atCap = build({ id: 4 }, [row(3), row(2), row(1)]);
    await expect(
      atCap.service.exportOperations({ userId }, 3),
    ).resolves.toHaveLength(3);

    const over = build({ id: 4 }, [row(4), row(3), row(2), row(1)]);
    await expect(
      over.service.exportOperations({ userId }, 3),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
