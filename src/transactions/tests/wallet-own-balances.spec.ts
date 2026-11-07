import { ConflictException } from '@nestjs/common';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { toCrypto } from '../../common/utils/to-crypto';
import { TraderSettings } from '../../trader-settings/entities/trader-settings.entity';
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
) => {
  const inserted = {
    values: () => ({ orIgnore: () => ({ execute: async () => undefined }) }),
  };
  const manager = {
    findOne: jest.fn(async () => wallet),
    save: jest.fn(async (value: unknown) => value),
    create: jest.fn((_entity: unknown, value: object) => ({ ...value })),
    update: jest.fn(async () => undefined),
    createQueryBuilder: jest.fn(() => ({
      insert: () => ({ into: () => inserted }),
    })),
  };
  const service = new WalletService(
    {} as never,
    {} as never,
    {
      get: jest.fn((key: string, fallback: unknown) => env[key] ?? fallback),
    } as never,
    { insurancePayInMinOf: jest.fn(() => toCrypto(insuranceMinimum)) } as never,
  );

  return { service, manager };
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

    it('allows it when no deal was ever accepted', async () => {
      const wallet = walletOf();
      const { service, manager } = build(wallet);

      await service.moveBetweenOwnBalancesWithin(manager as never, back);

      expect(wallet.mainBalance).toEqual(toCrypto('1200.5'));
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
    });
  });
});

describe('WalletService.stampAcceptedDealWithin', () => {
  it('writes the moment on the trader’s wallet', async () => {
    const { service, manager } = build(walletOf());

    await service.stampAcceptedDealWithin(manager as never, USER, NOW);

    expect(manager.update).toHaveBeenCalledWith(
      Wallet,
      { userId: USER },
      { lastAcceptedDealAt: NOW },
    );
  });
});
