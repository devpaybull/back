import { ConflictException } from '@nestjs/common';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { toCrypto } from '../../common/utils/to-crypto';
import { TraderSettings } from '../../trader-settings/entities/trader-settings.entity';
import { In } from 'typeorm';
import { TransactionDispute } from '../entities/transaction-dispute.entity';
import { Transaction } from '../entities/transaction.entity';
import { DisputeStatus } from '../types/dispute-status.enum';
import { Wallet } from '../entities/wallet.entity';
import { WalletService } from '../services/wallet.service';
import { BalanceKind } from '../types/balance-kind.enum';
import { BalanceOperationType } from '../types/balance-operation-type.enum';

const USER = uuidOf(1);
const NOW = new Date('2026-11-20T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

const walletOf = (overrides: Partial<Wallet> = {}): Wallet =>
  ({
    id: 1,
    userId: USER,
    mainBalance: toCrypto(1000),
    mainReserved: toCrypto(0),
    insurancePayInBalance: toCrypto(500),
    insurancePayOutBalance: toCrypto(300),
    insurancePayInReserved: toCrypto(0),
    insurancePayOutReserved: toCrypto(0),
    lastAcceptedDealAt: null,
    ...overrides,
  }) as Wallet;

const build = (
  wallet: Wallet | null,
  env: Record<string, unknown> = {},
  insuranceMinimum = '500',
  latestAssignedDealAt: Date | null = null,
  liveDispute = false,
) => {
  const updated = {
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    setParameter: jest.fn().mockReturnThis(),
    execute: jest.fn(async () => undefined),
  };
  const latestDeal = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    setParameter: jest.fn().mockReturnThis(),
    getRawOne: jest.fn(async () => ({ at: latestAssignedDealAt })),
  };
  const inserted = {
    values: () => ({ orIgnore: () => ({ execute: async () => undefined }) }),
  };
  const manager = {
    findOne: jest.fn(async () => wallet),
    save: jest.fn(async (value: unknown) => value),
    create: jest.fn((_entity: unknown, value: object) => ({ ...value })),
    update: jest.fn(async () => undefined),
    exists: jest.fn(async () => liveDispute),
    createQueryBuilder: jest.fn((entity?: unknown) =>
      entity
        ? latestDeal
        : {
            insert: () => ({ into: () => inserted }),
            update: () => updated,
          },
    ),
  };
  const service = new WalletService(
    {} as never,
    {} as never,
    {
      get: jest.fn((key: string, fallback: unknown) => env[key] ?? fallback),
    } as never,
    { insurancePayInMinOf: jest.fn(() => toCrypto(insuranceMinimum)) } as never,
  );

  return { service, manager, updated, latestDeal };
};

const codeOf = (error: unknown) =>
  ((error as ConflictException).getResponse() as { code?: string }).code;

describe('WalletService.moveBetweenOwnBalancesWithin', () => {
  const move = {
    userId: USER,
    from: BalanceKind.Main,
    to: BalanceKind.InsurancePayIn,
    amount: toCrypto('200.5'),
    accountTransactionId: 7,
  };

  it('moves the amount and journals one leg per balance, before and after', async () => {
    const wallet = walletOf();
    const { service, manager } = build(wallet);

    await service.moveBetweenOwnBalancesWithin(manager as never, move);

    expect(wallet.mainBalance).toEqual(toCrypto('799.5'));
    expect(wallet.insurancePayInBalance).toEqual(toCrypto('700.5'));
    expect(manager.save).toHaveBeenCalledWith(wallet);
    expect(manager.save).toHaveBeenCalledWith([
      expect.objectContaining({
        type: BalanceOperationType.Internal,
        balanceKind: BalanceKind.Main,
        amount: toCrypto('-200.5'),
        balanceBefore: toCrypto(1000),
        balanceAfter: toCrypto('799.5'),
        accountTransactionId: 7,
      }),
      expect.objectContaining({
        type: BalanceOperationType.Internal,
        balanceKind: BalanceKind.InsurancePayIn,
        amount: toCrypto('200.5'),
        balanceBefore: toCrypto(500),
        balanceAfter: toCrypto('700.5'),
        accountTransactionId: 7,
      }),
    ]);
  });

  it('counts only what is available on main: the escrow is not spendable', async () => {
    const wallet = walletOf({
      mainBalance: toCrypto(300),
      mainReserved: toCrypto(200),
    });
    const { service, manager } = build(wallet);

    const error = await service
      .moveBetweenOwnBalancesWithin(manager as never, move)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(codeOf(error)).toBe('INSUFFICIENT_BALANCE');
    expect(wallet.mainBalance).toEqual(toCrypto(300));
    expect(manager.save).not.toHaveBeenCalled();
  });

  it.each([
    [BalanceKind.InsurancePayIn, 'insurancePayInReserved'],
    [BalanceKind.InsurancePayOut, 'insurancePayOutReserved'],
  ])('counts what is reserved on %s', async (from, reservedField) => {
    const wallet = walletOf({ [reservedField]: toCrypto(250) });
    const { service, manager } = build(wallet);

    const error = await service
      .moveBetweenOwnBalancesWithin(manager as never, {
        ...move,
        from,
        to: BalanceKind.Main,
        amount: toCrypto(251),
      })
      .catch((e: unknown) => e);

    expect(codeOf(error)).toBe('INSUFFICIENT_BALANCE');
  });

  describe('the delay back to main', () => {
    const back = {
      ...move,
      from: BalanceKind.InsurancePayIn,
      to: BalanceKind.Main,
      insuranceDelayCheckedAt: NOW,
    };

    it.each([BalanceKind.InsurancePayIn, BalanceKind.InsurancePayOut])(
      'refuses %s before 14 days, naming the date',
      async (from) => {
        const lastAcceptedDealAt = new Date(NOW.getTime() - 14 * DAY_MS + 1);
        const wallet = walletOf({ lastAcceptedDealAt });
        const { service, manager } = build(wallet);

        const error = await service
          .moveBetweenOwnBalancesWithin(manager as never, { ...back, from })
          .catch((e: unknown) => e);

        expect((error as ConflictException).getResponse()).toMatchObject({
          statusCode: 409,
          code: 'INSURANCE_WITHDRAWAL_DELAYED',
          availableAt: new Date(NOW.getTime() + 1).toISOString(),
        });
        expect(manager.save).not.toHaveBeenCalled();
      },
    );

    it('allows it at exactly 14 days', async () => {
      const wallet = walletOf({
        lastAcceptedDealAt: new Date(NOW.getTime() - 14 * DAY_MS),
      });
      const { service, manager } = build(wallet);

      await service.moveBetweenOwnBalancesWithin(manager as never, back);

      expect(wallet.insurancePayInBalance).toEqual(toCrypto('299.5'));
    });

    it('allows it when the trader never had a deal', async () => {
      const wallet = walletOf();
      const { service, manager } = build(wallet);

      await service.moveBetweenOwnBalancesWithin(manager as never, back);

      expect(wallet.mainBalance).toEqual(toCrypto('1200.5'));
    });

    it('without a stamp, counts from the latest deal assigned to the trader, through the transaction', async () => {
      const assigned = new Date(NOW.getTime() - 3 * DAY_MS);
      const wallet = walletOf();
      const { service, manager, latestDeal } = build(
        wallet,
        {},
        '500',
        assigned,
      );

      const error = await service
        .moveBetweenOwnBalancesWithin(manager as never, back)
        .catch((e: unknown) => e);

      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'INSURANCE_WITHDRAWAL_DELAYED',
        availableAt: new Date(assigned.getTime() + 14 * DAY_MS).toISOString(),
      });
      expect(manager.createQueryBuilder).toHaveBeenCalledWith(
        Transaction,
        'deal',
      );
      expect(latestDeal.where).toHaveBeenCalledWith(
        'deal."traderUserId" = :traderUserId',
        { traderUserId: USER },
      );
      expect(latestDeal.select.mock.calls[0][0]).toContain(
        'COALESCE(deal."payoutTakenAt", deal."createdAt")',
      );
      expect(wallet.mainBalance).toEqual(toCrypto(1000));
    });

    it('does not look for a deal when the wallet is stamped', async () => {
      const wallet = walletOf({
        lastAcceptedDealAt: new Date(NOW.getTime() - 20 * DAY_MS),
      });
      const { service, manager, latestDeal } = build(wallet, {}, '500', NOW);

      await service.moveBetweenOwnBalancesWithin(manager as never, back);

      expect(latestDeal.getRawOne).not.toHaveBeenCalled();
    });

    it('refuses the trader’s own move out of either insurance while a dispute of theirs is open or reviewing, under the wallet lock', async () => {
      for (const from of [
        BalanceKind.InsurancePayIn,
        BalanceKind.InsurancePayOut,
      ]) {
        const wallet = walletOf();
        const { service, manager } = build(wallet, {}, '500', null, true);

        const error = await service
          .moveBetweenOwnBalancesWithin(manager as never, { ...back, from })
          .catch((e: unknown) => e);

        expect((error as ConflictException).getResponse()).toMatchObject({
          statusCode: 409,
          code: 'INSURANCE_LOCKED_BY_DISPUTE',
        });
        expect(manager.exists).toHaveBeenCalledWith(TransactionDispute, {
          where: {
            status: In([DisputeStatus.Open, DisputeStatus.Reviewing]),
            transaction: { traderUserId: USER },
          },
        });
        expect(manager.findOne.mock.invocationCallOrder[0]).toBeLessThan(
          manager.exists.mock.invocationCallOrder[0],
        );
        expect(manager.save).not.toHaveBeenCalled();
      }
    });

    it('lets an admin move the insurance whatever the disputes, and lets money into the insurance', async () => {
      const wallet = walletOf();
      const { service, manager } = build(wallet, {}, '500', null, true);

      await service.moveBetweenOwnBalancesWithin(manager as never, {
        ...back,
        insuranceDelayCheckedAt: undefined,
      });
      await service.moveBetweenOwnBalancesWithin(manager as never, {
        ...move,
        insuranceDelayCheckedAt: NOW,
      });

      expect(manager.exists).not.toHaveBeenCalled();
    });

    it('is not applied without a check moment: an admin moves any time', async () => {
      const wallet = walletOf({ lastAcceptedDealAt: NOW });
      const { service, manager } = build(wallet);

      await service.moveBetweenOwnBalancesWithin(manager as never, {
        ...back,
        insuranceDelayCheckedAt: undefined,
      });

      expect(wallet.mainBalance).toEqual(toCrypto('1200.5'));
    });

    it('does not hold money going into the insurance', async () => {
      const wallet = walletOf({ lastAcceptedDealAt: NOW });
      const { service, manager } = build(wallet);

      await service.moveBetweenOwnBalancesWithin(manager as never, {
        ...move,
        insuranceDelayCheckedAt: NOW,
      });

      expect(wallet.insurancePayInBalance).toEqual(toCrypto('700.5'));
    });
  });
});

describe('WalletService.assertMayEnableTradingWithin', () => {
  const settings = {} as TraderSettings;

  it('allows insurance at its minimum and available above the threshold', async () => {
    const { service, manager } = build(walletOf(), {
      MAIN_BALANCE_MIN_THRESHOLD: '999.999999',
    });

    await expect(
      service.assertMayEnableTradingWithin(manager as never, USER, settings),
    ).resolves.toBeUndefined();
  });

  it.each([
    [
      'insurance below the minimum',
      walletOf(),
      {},
      '500.000001',
      'INSURANCE_BELOW_MINIMUM',
    ],
    [
      'available at the threshold',
      walletOf(),
      { MAIN_BALANCE_MIN_THRESHOLD: '1000' },
      '500',
      'BALANCE_BELOW_THRESHOLD',
    ],
    [
      'the escrow counted out of the balance',
      walletOf({ mainReserved: toCrypto(1000) }),
      {},
      '500',
      'BALANCE_BELOW_THRESHOLD',
    ],
    ['no wallet and a minimum', null, {}, '500', 'INSURANCE_BELOW_MINIMUM'],
    ['no wallet and no minimum', null, {}, '0', 'BALANCE_BELOW_THRESHOLD'],
  ])('refuses %s', async (_name, wallet, env, minimum, code) => {
    const { service, manager } = build(wallet, env, minimum);

    const error = await service
      .assertMayEnableTradingWithin(manager as never, USER, settings)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(codeOf(error)).toBe(code);
  });

  it('reads the wallet through the transaction’s manager', async () => {
    const { service, manager } = build(walletOf());

    await service.assertMayEnableTradingWithin(
      manager as never,
      USER,
      settings,
    );

    expect(manager.findOne).toHaveBeenCalledWith(Wallet, {
      where: { userId: USER },
      lock: { mode: 'pessimistic_read' },
    });
  });
});

describe('WalletService.stampAcceptedDealWithin', () => {
  it('never moves the moment backwards', async () => {
    const { service, manager, updated } = build(walletOf());

    await service.stampAcceptedDealWithin(manager as never, USER, NOW);

    const [{ lastAcceptedDealAt }] = updated.set.mock.calls[0] as [
      { lastAcceptedDealAt: () => string },
    ];
    expect(lastAcceptedDealAt()).toBe(
      'GREATEST(COALESCE("lastAcceptedDealAt", :acceptedAt), :acceptedAt)',
    );
    expect(updated.where).toHaveBeenCalledWith('"userId" = :userId', {
      userId: USER,
    });
    expect(updated.setParameter).toHaveBeenCalledWith('acceptedAt', NOW);
    expect(updated.execute).toHaveBeenCalledTimes(1);
  });
});
