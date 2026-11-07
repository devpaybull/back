import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { In } from 'typeorm';
import { Crypto } from '../../common/types/crypto';
import { toCrypto } from '../../common/utils/to-crypto';
import { toRate } from '../../common/utils/to-rate';
import { toFiat } from '../../common/utils/to-fiat';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { TraderLead } from '../../users/entities/trader-lead.entity';
import { Transaction } from '../entities/transaction.entity';
import { TransactionLeadShare } from '../entities/transaction-lead-share.entity';
import { TransactionService } from '../services/transaction.service';
import { CandidateRejectedError } from '../exceptions/candidate-rejected.exception';
import { CreateDealInput } from '../types/create-deal-input';
import { DealCandidate } from '../types/deal-candidate';
import { IssuedDealInput } from '../types/issued-deal-input';
import { PayOutRequestInput } from '../types/pay-out-request-input';
import { SelectionFilter } from '../types/selection-filter.enum';
import { StatusEventSource } from '../types/status-event-source.enum';
import { TransactionKind } from '../types/transaction-kind.enum';
import { TransactionMethod } from '../types/transaction-method';
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
            directions: ['pay_in', 'pay_out'],
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
    exists: jest.fn(async () => false),
  };
  const dataSource = {
    transaction: jest.fn(
      async (work: (entityManager: typeof manager) => unknown) => work(manager),
    ),
  };
  const wallets = {
    reserveMainEscrowWithin: jest.fn<Promise<void>, [unknown, string, Crypto]>(
      async () => undefined,
    ),
    lockWalletsWithin: jest.fn(async () => undefined),
    debitMainWithin: jest.fn(async () => undefined),
    creditMainWithin: jest.fn(async () => undefined),
    releaseEscrowWithin: jest.fn(async () => undefined),
    creditLeadShareWithin: jest.fn(async () => undefined),
  };
  const merchantBalances = {
    creditDealWithin: jest.fn(async () => undefined),
    holdPayOutWithin: jest.fn(async () => undefined),
    settlePayOutWithin: jest.fn(async () => undefined),
    releasePayOutWithin: jest.fn(async () => null),
  };
  const merchantSettings = {
    allowsOverdraftWithin: jest.fn(async () => false),
    payInWindowMinutesOf: jest.fn(async (): Promise<number | null> => null),
  };
  const rates = {
    resolveLeadPercents: jest.fn(
      async (): Promise<{ leadUserId: string; percent: number }[]> => [],
    ),
  };
  const counterpartyStats = {
    recordDealCreatedWithin: jest.fn(async () => undefined),
    recordDisputeWithin: jest.fn(async () => undefined),
    recordCompletedWithin: jest.fn(async () => undefined),
  };
  const audit = { record: jest.fn(async () => undefined) };
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
    merchantBalances as never,
    audit as never,
    rates as never,
    team as never,
    merchantSettings as never,
    config as never,
    counterpartyStats as never,
    { recordWithin: jest.fn(async () => undefined) } as never,
  );

  return {
    service,
    audit,
    counterpartyStats,
    manager,
    dataSource,
    wallets,
    merchantBalances,
    merchantSettings,
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
    amountFiat: toFiat(10000),
    rate: toRate(100),
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

  it.each([
    ['a fiat amount with a third decimal', { amountFiat: toFiat('100.005') }],
    ['a rate with a seventh decimal', { rate: toRate('88.9200001') }],
  ])(
    'refuses %s before pricing anything, rather than storing a rounded figure',
    async (_case, overrides) => {
      const { service, wallets, dataSource, team } = build();

      await expect(service.createDeal(input(overrides))).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(team.assignmentsOf).not.toHaveBeenCalled();
      expect(wallets.reserveMainEscrowWithin).not.toHaveBeenCalled();
      expect(dataSource.transaction).not.toHaveBeenCalled();
    },
  );

  it('stores the method code of a registered method as it was given', async () => {
    const { service } = build();

    const created = await service.createDeal(
      input({ kind: TransactionKind.PayIn, method: 'mobile_commerce' }),
    );

    expect(created.method).toBe('mobile_commerce');
  });

  it.each<TransactionMethod>(['counterparty', 'mobile_commerce'])(
    'refuses a pay-out through %s, a pay-in-only method, before any lookup or transaction',
    async (method) => {
      const { service, team, wallets, dataSource } = build();

      await expect(
        service.createDeal(input({ kind: TransactionKind.PayOut, method })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(team.assignmentsOf).not.toHaveBeenCalled();
      expect(wallets.reserveMainEscrowWithin).not.toHaveBeenCalled();
      expect(dataSource.transaction).not.toHaveBeenCalled();
    },
  );

  it('resolves the lead rates from the trader’s assignments, not from the caller', async () => {
    const { service, rates, team, links } = build();

    await service.createDeal(input({ amountFiat: toFiat(2500), bankId: 4 }));

    expect(team.assignmentsOf).toHaveBeenCalledWith(TRADER);
    expect(rates.resolveLeadPercents).toHaveBeenCalledWith({
      links,
      method: 'sbp',
      amount: toFiat(2500),
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
    expect(created.leadCommission).toEqual(toCrypto(2.5));
    expect(manager.create).toHaveBeenCalledWith(TransactionLeadShare, {
      transactionId: uuidOf(50),
      leadUserId: LEAD_A,
      percent: 2.5,
      amount: toCrypto(2.5),
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
      {
        transactionId: uuidOf(50),
        leadUserId: LEAD_A,
        percent: 1,
        amount: toCrypto(1),
      },
      {
        transactionId: uuidOf(50),
        leadUserId: LEAD_B,
        percent: 0.5,
        amount: toCrypto(0.5),
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
      toCrypto('93.896714'),
    );
  });

  const withRollback = (built: ReturnType<typeof build>) => {
    const wallet = { mainReserved: toCrypto(0) };
    built.wallets.reserveMainEscrowWithin.mockImplementation(
      async (_manager: unknown, _userId: string, amount: Crypto) => {
        wallet.mainReserved = toCrypto(wallet.mainReserved.plus(amount));
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
    expect(wallet.mainReserved).toEqual(toCrypto('93.896714'));
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
    expect(wallet.mainReserved).toEqual(toCrypto(0));
  });

  it('reserves nothing for a pay-out', async () => {
    const { service, wallets } = build();

    await service.createDeal(input({ kind: TransactionKind.PayOut }));

    expect(wallets.reserveMainEscrowWithin).not.toHaveBeenCalled();
  });
});

describe('TransactionService.createIssuedDeal', () => {
  const issued: IssuedDealInput = {
    kind: TransactionKind.PayIn,
    method: 'sbp',
    merchantId: uuidOf(3),
    amountFiat: toFiat(10000),
    rate: toRate(100),
    merchantPercent: 10,
  };
  const candidate = (n: number, traderPercent = 7): DealCandidate => ({
    traderUserId: uuidOf(n),
    bankDetailsId: uuidOf(100 + n),
    bankId: 4,
    traderPercent,
  });

  it('inserts the deal for the first candidate that passes, in the transaction that checked it', async () => {
    const { service, dataSource, wallets, manager } = build();
    const checkWithin = jest.fn(async () => undefined);
    const afterInsertWithin = jest.fn(async () => undefined);

    const result = await service.createIssuedDeal(issued, [candidate(1)], {
      checkWithin,
      afterInsertWithin,
    });

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(checkWithin).toHaveBeenCalledWith(manager, candidate(1));
    expect(wallets.reserveMainEscrowWithin).toHaveBeenCalledWith(
      manager,
      uuidOf(1),
      expect.anything(),
    );
    expect(result.transaction).toMatchObject({
      traderUserId: uuidOf(1),
      bankDetailsId: uuidOf(101),
      traderPercent: 7,
    });
    expect(afterInsertWithin).toHaveBeenCalledWith(
      manager,
      candidate(1),
      result.transaction,
    );
    expect(result.skipped).toEqual([]);
  });

  it('moves to the next candidate when the check refuses one under its lock, inserting nothing for it', async () => {
    const { service, wallets, dataSource } = build();
    const checkWithin = jest.fn(async (_manager: unknown, c: DealCandidate) => {
      if (c.traderUserId === uuidOf(1)) {
        throw new CandidateRejectedError(SelectionFilter.MaxActive);
      }
    });

    const result = await service.createIssuedDeal(
      issued,
      [candidate(1), candidate(2)],
      { checkWithin },
    );

    expect(dataSource.transaction).toHaveBeenCalledTimes(2);
    expect(wallets.reserveMainEscrowWithin).toHaveBeenCalledTimes(1);
    expect(result.candidate).toEqual(candidate(2));
    expect(result.skipped).toEqual([
      { candidate: candidate(1), reason: SelectionFilter.MaxActive },
    ]);
  });

  it('skips a trader whose escrow does not fit under the wallet lock', async () => {
    const { service, wallets } = build();
    wallets.reserveMainEscrowWithin.mockRejectedValueOnce(
      new ConflictException('Insufficient available balance'),
    );

    const result = await service.createIssuedDeal(
      issued,
      [candidate(1), candidate(2)],
      { checkWithin: async () => undefined },
    );

    expect(result.candidate).toEqual(candidate(2));
    expect(result.skipped).toEqual([
      { candidate: candidate(1), reason: SelectionFilter.InsufficientBalance },
    ]);
  });

  it('skips a trader whose leads leave the platform below its minimum, before opening a transaction', async () => {
    const { service, rates, dataSource } = build();
    rates.resolveLeadPercents.mockResolvedValueOnce([
      { leadUserId: LEAD_A, percent: 9.5 },
    ]);

    const result = await service.createIssuedDeal(
      issued,
      [candidate(1, 1), candidate(2)],
      { checkWithin: async () => undefined },
    );

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(result.skipped).toEqual([
      { candidate: candidate(1, 1), reason: SelectionFilter.DealRefused },
    ]);
  });

  it('answers no deal with every skip when nobody passes', async () => {
    const { service } = build();

    const result = await service.createIssuedDeal(issued, [candidate(1)], {
      checkWithin: async () => {
        throw new CandidateRejectedError(SelectionFilter.DailyAmount);
      },
    });

    expect(result).toEqual({
      transaction: null,
      candidate: null,
      skipped: [
        { candidate: candidate(1), reason: SelectionFilter.DailyAmount },
      ],
    });
  });

  it('lets an unexpected failure through instead of trying the next one', async () => {
    const { service } = build();

    await expect(
      service.createIssuedDeal(issued, [candidate(1), candidate(2)], {
        checkWithin: async () => {
          throw new Error('connection lost');
        },
      }),
    ).rejects.toThrow('connection lost');
  });
});

describe('TransactionService.transition, settling lead shares', () => {
  const deal = (overrides: Partial<Transaction> = {}): Transaction =>
    ({
      id: uuidOf(50),
      kind: TransactionKind.PayIn,
      status: TransactionStatus.Active,
      traderUserId: TRADER,
      traderAmount: toCrypto(93.897),
      ...overrides,
    }) as Transaction;

  const share = (leadUserId: string, amount: number) =>
    ({
      transactionId: uuidOf(50),
      leadUserId,
      percent: amount,
      amount: toCrypto(amount),
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
        toCrypto(2.5),
        uuidOf(50),
      );
      expect(wallets.creditLeadShareWithin).toHaveBeenCalledWith(
        manager,
        LEAD_B,
        toCrypto(1),
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

describe('TransactionService.transition, the merchant balance', () => {
  const MERCHANT = uuidOf(3);
  const deal = (overrides: Partial<Transaction> = {}): Transaction =>
    ({
      id: uuidOf(50),
      kind: TransactionKind.PayIn,
      status: TransactionStatus.Active,
      traderUserId: TRADER,
      traderAmount: toCrypto(93.897),
      merchantId: MERCHANT,
      merchantAmount: toCrypto(90.5),
      ...overrides,
    }) as Transaction;

  const settle = async (
    transaction: Transaction,
    toStatus: TransactionStatus,
  ) => {
    const built = build();
    built.manager.findOne.mockResolvedValue(transaction);

    await built.service.transition(transaction.id, {
      toStatus,
      source: StatusEventSource.System,
    });

    return built;
  };

  it.each([TransactionStatus.Success, TransactionStatus.SuccessChanged])(
    'credits the merchant its merchant amount when a pay-in reaches %s',
    async (toStatus) => {
      const { merchantBalances, manager } = await settle(
        deal({
          status:
            toStatus === TransactionStatus.SuccessChanged
              ? TransactionStatus.ManualReview
              : TransactionStatus.Active,
        }),
        toStatus,
      );

      expect(merchantBalances.creditDealWithin).toHaveBeenCalledWith(
        manager,
        MERCHANT,
        toCrypto(90.5),
        uuidOf(50),
      );
      expect(merchantBalances.settlePayOutWithin).not.toHaveBeenCalled();
    },
  );

  it('settles the merchant its merchant amount when a pay-out succeeds', async () => {
    const { merchantBalances, manager } = await settle(
      deal({ kind: TransactionKind.PayOut }),
      TransactionStatus.Success,
    );

    expect(merchantBalances.settlePayOutWithin).toHaveBeenCalledWith(
      manager,
      MERCHANT,
      toCrypto(90.5),
      uuidOf(50),
    );
    expect(merchantBalances.creditDealWithin).not.toHaveBeenCalled();
  });

  it('moves the merchant balance only after every wallet movement', async () => {
    const { merchantBalances, wallets } = await settle(
      deal(),
      TransactionStatus.Success,
    );

    const merchantAt =
      merchantBalances.creditDealWithin.mock.invocationCallOrder[0];
    const walletMoves = [
      ...wallets.lockWalletsWithin.mock.invocationCallOrder,
      ...wallets.debitMainWithin.mock.invocationCallOrder,
    ];

    expect(walletMoves.every((order) => order < merchantAt)).toBe(true);
  });

  it('leaves the merchant balance alone when a pay-in is canceled', async () => {
    const { merchantBalances } = await settle(
      deal(),
      TransactionStatus.Canceled,
    );

    expect(merchantBalances.creditDealWithin).not.toHaveBeenCalled();
    expect(merchantBalances.settlePayOutWithin).not.toHaveBeenCalled();
    expect(merchantBalances.releasePayOutWithin).not.toHaveBeenCalled();
  });

  it('releases the merchant’s held amount when a pay-out is canceled', async () => {
    const { merchantBalances, manager } = await settle(
      deal({ kind: TransactionKind.PayOut }),
      TransactionStatus.Canceled,
    );

    expect(merchantBalances.releasePayOutWithin).toHaveBeenCalledWith(
      manager,
      MERCHANT,
      uuidOf(50),
    );
    expect(merchantBalances.settlePayOutWithin).not.toHaveBeenCalled();
  });

  it('touches no trader wallet when a pay-out nobody took is canceled', async () => {
    const { merchantBalances, wallets, manager } = await settle(
      deal({
        kind: TransactionKind.PayOut,
        status: TransactionStatus.Pending,
        traderUserId: null,
      }),
      TransactionStatus.Canceled,
    );

    expect(wallets.lockWalletsWithin).not.toHaveBeenCalled();
    expect(wallets.creditMainWithin).not.toHaveBeenCalled();
    expect(wallets.releaseEscrowWithin).not.toHaveBeenCalled();
    expect(merchantBalances.releasePayOutWithin).toHaveBeenCalledWith(
      manager,
      MERCHANT,
      uuidOf(50),
    );
  });

  it('releases nothing for a canceled pay-out without a merchant', async () => {
    const { merchantBalances } = await settle(
      deal({
        kind: TransactionKind.PayOut,
        merchantId: null as unknown as string,
      }),
      TransactionStatus.Canceled,
    );

    expect(merchantBalances.releasePayOutWithin).not.toHaveBeenCalled();
  });

  it('leaves it alone when a deal already success is settled again', async () => {
    const { merchantBalances } = await settle(
      deal({ status: TransactionStatus.Success }),
      TransactionStatus.Success,
    );

    expect(merchantBalances.creditDealWithin).not.toHaveBeenCalled();
  });

  it('moves nothing for a deal without a merchant', async () => {
    const { merchantBalances } = await settle(
      deal({ merchantId: null as unknown as string }),
      TransactionStatus.Success,
    );

    expect(merchantBalances.creditDealWithin).not.toHaveBeenCalled();
  });

  describe('a pay-out walked through its statuses', () => {
    const walk = async (statuses: TransactionStatus[]) => {
      const built = build();
      const transaction = deal({ kind: TransactionKind.PayOut });
      built.manager.findOne.mockResolvedValue(transaction);

      for (const toStatus of statuses) {
        await built.service.transition(transaction.id, {
          toStatus,
          source: StatusEventSource.System,
        });
      }

      return { ...built, transaction };
    };

    it('settles once when a dispute ends in success_changed', async () => {
      const { merchantBalances } = await walk([
        TransactionStatus.Dispute,
        TransactionStatus.ManualReview,
        TransactionStatus.SuccessChanged,
      ]);

      expect(merchantBalances.settlePayOutWithin).toHaveBeenCalledTimes(1);
      expect(merchantBalances.releasePayOutWithin).not.toHaveBeenCalled();
    });

    it('releases once when a dispute ends canceled', async () => {
      const { merchantBalances } = await walk([
        TransactionStatus.Dispute,
        TransactionStatus.ManualReview,
        TransactionStatus.Canceled,
      ]);

      expect(merchantBalances.releasePayOutWithin).toHaveBeenCalledTimes(1);
      expect(merchantBalances.settlePayOutWithin).not.toHaveBeenCalled();
    });

    it('moves nothing on the active → pending → active round trip and releases once on the cancel after it', async () => {
      const { merchantBalances } = await walk([
        TransactionStatus.Pending,
        TransactionStatus.Active,
      ]);

      expect(merchantBalances.releasePayOutWithin).not.toHaveBeenCalled();
      expect(merchantBalances.settlePayOutWithin).not.toHaveBeenCalled();
      expect(merchantBalances.holdPayOutWithin).not.toHaveBeenCalled();

      const after = await walk([
        TransactionStatus.Pending,
        TransactionStatus.Active,
        TransactionStatus.Canceled,
      ]);

      expect(after.merchantBalances.releasePayOutWithin).toHaveBeenCalledTimes(
        1,
      );
    });

    it('refuses success_changed → success with a 409 and moves nothing', async () => {
      const built = build();
      built.manager.findOne.mockResolvedValue(
        deal({
          kind: TransactionKind.PayOut,
          status: TransactionStatus.SuccessChanged,
        }),
      );

      await expect(
        built.service.transition(uuidOf(50), {
          toStatus: TransactionStatus.Success,
          source: StatusEventSource.System,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(built.merchantBalances.settlePayOutWithin).not.toHaveBeenCalled();
      expect(built.merchantBalances.releasePayOutWithin).not.toHaveBeenCalled();
    });

    it('leaves it alone when a pay-out already success is settled again', async () => {
      const { merchantBalances } = await settle(
        deal({
          kind: TransactionKind.PayOut,
          status: TransactionStatus.Success,
        }),
        TransactionStatus.Success,
      );

      expect(merchantBalances.settlePayOutWithin).not.toHaveBeenCalled();
    });

    it('moves the merchant balance of a pay-out only after the trader is credited', async () => {
      const { merchantBalances, wallets } = await settle(
        deal({ kind: TransactionKind.PayOut }),
        TransactionStatus.Success,
      );

      const merchantAt =
        merchantBalances.settlePayOutWithin.mock.invocationCallOrder[0];

      expect(
        [
          ...wallets.lockWalletsWithin.mock.invocationCallOrder,
          ...wallets.creditMainWithin.mock.invocationCallOrder,
        ].every((order) => order < merchantAt),
      ).toBe(true);
      expect(wallets.creditMainWithin).toHaveBeenCalled();
    });
  });
});

describe('TransactionService.createDeal, the merchant hold', () => {
  it('holds the merchant amount of a pay-out in the transaction that inserts it, after the insert', async () => {
    const { service, merchantBalances, manager } = build();

    const created = await service.createDeal(
      input({ kind: TransactionKind.PayOut }),
    );

    expect(merchantBalances.holdPayOutWithin).toHaveBeenCalledWith(
      manager,
      uuidOf(3),
      created.merchantAmount,
      uuidOf(50),
      expect.any(Function),
    );
    expect(manager.save.mock.invocationCallOrder[0]).toBeLessThan(
      merchantBalances.holdPayOutWithin.mock.invocationCallOrder[0],
    );
  });

  it('reads the overdraft switch through the hold, inside the deal transaction, never before it', async () => {
    const { service, merchantBalances, merchantSettings, manager } = build();
    merchantSettings.allowsOverdraftWithin.mockResolvedValueOnce(true);

    await service.createDeal(input({ kind: TransactionKind.PayOut }));

    expect(merchantSettings.allowsOverdraftWithin).not.toHaveBeenCalled();

    const [, , , , allowsOverdraft] = merchantBalances.holdPayOutWithin.mock
      .calls[0] as unknown as [
      unknown,
      unknown,
      unknown,
      unknown,
      () => Promise<boolean>,
    ];

    expect(await allowsOverdraft()).toBe(true);
    expect(merchantSettings.allowsOverdraftWithin).toHaveBeenCalledWith(
      manager,
      uuidOf(3),
    );
  });

  it('lets a refused hold fail the whole deal', async () => {
    const { service, merchantBalances } = build();
    merchantBalances.holdPayOutWithin.mockRejectedValueOnce(
      new ConflictException('The merchant balance does not cover the pay-out'),
    );

    await expect(
      service.createDeal(input({ kind: TransactionKind.PayOut })),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('holds nothing for a pay-in and does not read the overdraft switch', async () => {
    const { service, merchantBalances, merchantSettings } = build();

    await service.createDeal(input());

    expect(merchantBalances.holdPayOutWithin).not.toHaveBeenCalled();
    expect(merchantSettings.allowsOverdraftWithin).not.toHaveBeenCalled();
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

  it.each([TransactionKind.PayIn, TransactionKind.PayOut] as const)(
    'gives a merchant %s deal the merchant’s own payment window',
    async (kind) => {
      const { service, merchantSettings, config } = build();
      merchantSettings.payInWindowMinutesOf.mockResolvedValueOnce(45);

      const created = await service.createDeal(input({ kind }));

      expect(merchantSettings.payInWindowMinutesOf).toHaveBeenCalledWith(
        uuidOf(3),
      );
      expect(config.getOrThrow).not.toHaveBeenCalledWith('DEAL_TTL_MINUTES');
      expect(created.expiresAt).toEqual(new Date(NOW.getTime() + 45 * 60_000));
    },
  );

  it('falls back to DEAL_TTL_MINUTES when the merchant has no window', async () => {
    const { service, merchantSettings } = build();

    const created = await service.createDeal(input());

    expect(merchantSettings.payInWindowMinutesOf).toHaveBeenCalledWith(
      uuidOf(3),
    );
    expect(created.expiresAt).toEqual(
      new Date(NOW.getTime() + DEAL_TTL_MINUTES * 60_000),
    );
  });

  it('does not ask for a window when the deal has no merchant', async () => {
    const { service, merchantSettings } = build();

    const created = await service.createDeal(
      input({ merchantId: null as never }),
    );

    expect(merchantSettings.payInWindowMinutesOf).not.toHaveBeenCalled();
    expect(created.expiresAt).toEqual(
      new Date(NOW.getTime() + DEAL_TTL_MINUTES * 60_000),
    );
  });

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
      traderAmount: toCrypto(10),
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
      traderAmount: toCrypto(93.897),
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
      toCrypto(93.897),
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
      {} as never,
      {} as never,
      {} as never,
      { recordWithin: jest.fn(async () => undefined) } as never,
    );

    return { service, repository, builder, rows };
  };

  it('pages with the where and the order of the list helpers', async () => {
    const { service, repository, rows } = buildList();

    const page = await service.list(
      query({
        amountFrom: toFiat(100),
        sortBy: TransactionSortField.AmountFiat,
      }),
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

describe('TransactionService, counterparty statistics', () => {
  const lockedDeal = (overrides: Partial<Transaction> = {}): Transaction =>
    ({
      id: uuidOf(50),
      kind: TransactionKind.PayIn,
      method: 'sbp',
      status: TransactionStatus.Active,
      traderUserId: TRADER,
      traderAmount: toCrypto(93.897),
      amountFiat: toFiat('1500.50'),
      counterpartyId: 8,
      ...overrides,
    }) as Transaction;

  const moveTo = (
    built: ReturnType<typeof build>,
    deal: Transaction,
    toStatus: TransactionStatus,
  ) =>
    built.service.transitionLocked(built.manager as never, deal, {
      toStatus,
      source: StatusEventSource.System,
    });

  describe('createDeal', () => {
    it('records the new deal of a counterparty inside the same transaction', async () => {
      const built = build();

      await built.service.createDeal(input({ counterpartyId: 8 }));

      expect(
        built.counterpartyStats.recordDealCreatedWithin,
      ).toHaveBeenCalledWith(built.manager, 8);
    });

    it('records nothing for a deal without a counterparty', async () => {
      const built = build();

      await built.service.createDeal(input());

      expect(
        built.counterpartyStats.recordDealCreatedWithin,
      ).not.toHaveBeenCalled();
    });

    it('records nothing for a pay-out even with a counterparty', async () => {
      const built = build();

      await built.service.createDeal(
        input({ kind: TransactionKind.PayOut, counterpartyId: 8 }),
      );

      expect(
        built.counterpartyStats.recordDealCreatedWithin,
      ).not.toHaveBeenCalled();
    });
  });

  describe('transitionLocked', () => {
    it('records a dispute', async () => {
      const built = build();

      await moveTo(built, lockedDeal(), TransactionStatus.Dispute);

      expect(built.counterpartyStats.recordDisputeWithin).toHaveBeenCalledWith(
        built.manager,
        8,
      );
      expect(
        built.counterpartyStats.recordCompletedWithin,
      ).not.toHaveBeenCalled();
    });

    it('records a success as paid with the amount and the resolution time', async () => {
      const built = build();

      const result = await moveTo(
        built,
        lockedDeal(),
        TransactionStatus.Success,
      );

      expect(
        built.counterpartyStats.recordCompletedWithin,
      ).toHaveBeenCalledWith(built.manager, 8, {
        paid: true,
        amountFiat: toFiat('1500.50'),
        resolvedAt: result.resolvedAt,
      });
    });

    it('records a cancellation as not paid', async () => {
      const built = build();

      await moveTo(built, lockedDeal(), TransactionStatus.Canceled);

      expect(
        built.counterpartyStats.recordCompletedWithin,
      ).toHaveBeenCalledWith(
        built.manager,
        8,
        expect.objectContaining({ paid: false }),
      );
    });

    it('records nothing for a non-final, non-dispute step', async () => {
      const built = build();

      await moveTo(built, lockedDeal(), TransactionStatus.Checking);

      expect(
        built.counterpartyStats.recordDisputeWithin,
      ).not.toHaveBeenCalled();
      expect(
        built.counterpartyStats.recordCompletedWithin,
      ).not.toHaveBeenCalled();
    });

    it('records nothing when a final status is repeated', async () => {
      const built = build();

      await moveTo(
        built,
        lockedDeal({ status: TransactionStatus.Success }),
        TransactionStatus.Success,
      );

      expect(
        built.counterpartyStats.recordDisputeWithin,
      ).not.toHaveBeenCalled();
      expect(
        built.counterpartyStats.recordCompletedWithin,
      ).not.toHaveBeenCalled();
    });

    it('records nothing for a deal without a counterparty', async () => {
      const built = build();

      await moveTo(
        built,
        lockedDeal({ counterpartyId: null }),
        TransactionStatus.Success,
      );

      expect(
        built.counterpartyStats.recordCompletedWithin,
      ).not.toHaveBeenCalled();
    });
  });
});

describe('TransactionService, the merchant API fields of a deal', () => {
  it('createDeal stores what the merchant sent with the pay-in', async () => {
    const { service } = build();
    const payerInfo = { userId: 'client-1', ip: '203.0.113.7' };

    const created = await service.createDeal(
      input({
        merchantTransactionId: 'order-1',
        payerInfo,
        requestedBankId: 7,
        requestedOperatorId: 3,
        payerBankId: 8,
        callbackUrl: 'https://merchant.example/cb',
        successUrl: 'https://merchant.example/ok',
        errorUrl: 'https://merchant.example/err',
        requestedAmountFiat: toFiat(9990),
      }),
    );

    expect(created).toMatchObject({
      merchantTransactionId: 'order-1',
      payerInfo,
      requestedBankId: 7,
      requestedOperatorId: 3,
      payerBankId: 8,
      callbackUrl: 'https://merchant.example/cb',
      successUrl: 'https://merchant.example/ok',
      errorUrl: 'https://merchant.example/err',
      requestedAmountFiat: toFiat(9990),
    });
  });

  it('leaves them null for a caller that sends none', async () => {
    const { service } = build();

    const created = await service.createDeal(input());

    expect(created).toMatchObject({
      merchantTransactionId: null,
      payerInfo: null,
      requestedBankId: null,
      requestedOperatorId: null,
      requestedAmountFiat: null,
    });
  });
});

describe('TransactionService, the merchant API lookups', () => {
  const MERCHANT = uuidOf(3);
  const buildLookups = () => {
    const repository = {
      findOne: jest.fn(async () => null),
      count: jest.fn(async () => 2),
    };
    const service = new TransactionService(
      {} as never,
      repository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { recordWithin: jest.fn(async () => undefined) } as never,
    );

    return { repository, service };
  };

  it('finds a deal by the merchant’s own key, scoped to the merchant', async () => {
    const { repository, service } = buildLookups();

    await service.findByMerchantTransactionId(MERCHANT, 'order-1');

    expect(repository.findOne).toHaveBeenCalledWith({
      where: { merchantId: MERCHANT, merchantTransactionId: 'order-1' },
    });
  });

  it('a same request is an active pay-in of the client with the same method and requested amount, newest first', async () => {
    const { repository, service } = buildLookups();

    await service.findActiveSameRequest({
      merchantId: MERCHANT,
      counterpartyId: 11,
      method: 'sbp',
      requestedAmountFiat: toFiat(2000),
    });

    expect(repository.findOne).toHaveBeenCalledWith({
      where: {
        kind: TransactionKind.PayIn,
        status: TransactionStatus.Active,
        merchantId: MERCHANT,
        counterpartyId: 11,
        method: 'sbp',
        requestedAmountFiat: toFiat(2000),
      },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
  });

  it('failed pay-ins are active + canceled pay-ins of the client created since the given moment', async () => {
    const { repository, service } = buildLookups();
    const since = new Date('2026-11-04T09:00:00Z');

    await expect(
      service.countFailedPayInsSince(MERCHANT, 11, since),
    ).resolves.toBe(2);

    const [options] = repository.count.mock.calls[0] as unknown as [
      { where: Record<string, unknown> },
    ];
    expect(options.where).toMatchObject({
      kind: TransactionKind.PayIn,
      merchantId: MERCHANT,
      counterpartyId: 11,
      status: In([TransactionStatus.Active, TransactionStatus.Canceled]),
    });
    expect(options.where.createdAt).toMatchObject({
      _type: 'moreThanOrEqual',
      _value: since,
    });
  });
});

describe('TransactionService: the merchant cancels and extends', () => {
  const MERCHANT = uuidOf(80);
  const DEAL = uuidOf(81);
  const CREATED = new Date('2026-11-04T10:00:00.000Z');
  const EXPIRES = new Date('2026-11-04T10:15:00.000Z');
  const NOW = new Date('2026-11-04T10:05:00.000Z');

  const merchantDeal = (overrides: Partial<Transaction> = {}): Transaction =>
    ({
      id: DEAL,
      merchantId: MERCHANT,
      kind: TransactionKind.PayIn,
      status: TransactionStatus.Active,
      traderUserId: TRADER,
      traderAmount: toCrypto(20),
      merchantAmount: toCrypto(18),
      counterpartyId: null,
      createdAt: CREATED,
      expiresAt: EXPIRES,
      timerExtendedAt: null,
      ...overrides,
    }) as Transaction;

  const statusEvents = (saved: unknown[]) =>
    saved.filter(
      (row) =>
        (row as { toStatus?: unknown }).toStatus !== undefined &&
        (row as { transactionId?: unknown }).transactionId === DEAL,
    );

  describe('cancelByMerchant', () => {
    it('reads the deal under a row lock scoped to the merchant', async () => {
      const built = build();
      built.manager.findOne.mockResolvedValue(merchantDeal());

      await built.service.cancelByMerchant(MERCHANT, DEAL);

      expect(built.manager.findOne).toHaveBeenCalledWith(Transaction, {
        where: { id: DEAL, merchantId: MERCHANT },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('is a 404 for a deal that is missing or another merchant’s', async () => {
      const built = build();

      await expect(
        built.service.cancelByMerchant(MERCHANT, DEAL),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(built.audit.record).not.toHaveBeenCalled();
    });

    it('cancels an active pay-in: escrow released, event from the merchant, audit row without an actor', async () => {
      const built = build();
      const deal = merchantDeal();
      built.manager.findOne.mockResolvedValue(deal);

      const result = await built.service.cancelByMerchant(MERCHANT, DEAL);

      expect(result.status).toBe(TransactionStatus.Canceled);
      expect(result.resolvedAt).toBeInstanceOf(Date);
      expect(built.wallets.releaseEscrowWithin).toHaveBeenCalledWith(
        built.manager,
        TRADER,
        toCrypto(20),
      );
      expect(statusEvents(built.saved)).toEqual([
        expect.objectContaining({
          fromStatus: TransactionStatus.Active,
          toStatus: TransactionStatus.Canceled,
          source: StatusEventSource.Merchant,
          actorUserId: null,
          reason: 'merchant_canceled',
        }),
      ]);
      expect(built.audit.record).toHaveBeenCalledWith(
        {
          actorUserId: null,
          action: 'merchant_api.deal_canceled',
          metadata: {
            merchantId: MERCHANT,
            transactionId: DEAL,
            fromStatus: TransactionStatus.Active,
          },
        },
        built.manager,
      );
    });

    it('cancels a pending pay-out and returns the merchant’s hold', async () => {
      const built = build();
      built.manager.findOne.mockResolvedValue(
        merchantDeal({
          kind: TransactionKind.PayOut,
          status: TransactionStatus.Pending,
        }),
      );

      const result = await built.service.cancelByMerchant(MERCHANT, DEAL);

      expect(result.status).toBe(TransactionStatus.Canceled);
      expect(built.merchantBalances.releasePayOutWithin).toHaveBeenCalledWith(
        built.manager,
        MERCHANT,
        DEAL,
      );
      expect(built.wallets.releaseEscrowWithin).not.toHaveBeenCalled();
    });

    it('answers an already canceled deal as it is, moving nothing and auditing nothing', async () => {
      const built = build();
      const deal = merchantDeal({ status: TransactionStatus.Canceled });
      built.manager.findOne.mockResolvedValue(deal);

      await expect(
        built.service.cancelByMerchant(MERCHANT, DEAL),
      ).resolves.toBe(deal);
      expect(built.manager.save).not.toHaveBeenCalled();
      expect(built.wallets.releaseEscrowWithin).not.toHaveBeenCalled();
      expect(built.audit.record).not.toHaveBeenCalled();
    });

    it.each([
      [TransactionKind.PayIn, TransactionStatus.Checking],
      [TransactionKind.PayIn, TransactionStatus.CheckingManually],
      [TransactionKind.PayIn, TransactionStatus.Dispute],
      [TransactionKind.PayIn, TransactionStatus.ManualReview],
      [TransactionKind.PayIn, TransactionStatus.Success],
      [TransactionKind.PayIn, TransactionStatus.SuccessChanged],
      [TransactionKind.PayOut, TransactionStatus.Active],
      [TransactionKind.PayOut, TransactionStatus.Dispute],
      [TransactionKind.PayOut, TransactionStatus.Success],
    ])(
      'refuses a %s in %s with a 409 and changes nothing',
      async (kind, status) => {
        const built = build();
        const deal = merchantDeal({ kind, status });
        built.manager.findOne.mockResolvedValue(deal);

        await expect(
          built.service.cancelByMerchant(MERCHANT, DEAL),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(deal.status).toBe(status);
        expect(built.manager.save).not.toHaveBeenCalled();
        expect(built.audit.record).not.toHaveBeenCalled();
      },
    );
  });

  describe('extendTimerByMerchant', () => {
    it.each([TransactionStatus.Active, TransactionStatus.Checking])(
      'adds the original window once to a pay-in in %s, stamps timerExtendedAt and audits it',
      async (status) => {
        const built = build();
        const deal = merchantDeal({ status });
        built.manager.findOne.mockResolvedValue(deal);

        const result = await built.service.extendTimerByMerchant(
          MERCHANT,
          DEAL,
          NOW,
        );

        expect(result.expiresAt).toEqual(new Date('2026-11-04T10:30:00.000Z'));
        expect(result.timerExtendedAt).toBe(NOW);
        expect(result.status).toBe(status);
        expect(built.manager.save).toHaveBeenCalledWith(deal);
        expect(built.audit.record).toHaveBeenCalledWith(
          {
            actorUserId: null,
            action: 'merchant_api.timer_extended',
            metadata: {
              merchantId: MERCHANT,
              transactionId: DEAL,
              status,
              expiresAtBefore: EXPIRES.toISOString(),
              expiresAt: '2026-11-04T10:30:00.000Z',
            },
          },
          built.manager,
        );
      },
    );

    it.each<[string, Partial<Transaction>]>([
      ['already extended', { timerExtendedAt: CREATED }],
      ['a pay-out', { kind: TransactionKind.PayOut }],
      [
        'a pending pay-out',
        { kind: TransactionKind.PayOut, status: TransactionStatus.Pending },
      ],
      ['past its deadline', { expiresAt: NOW }],
      ['without a deadline', { expiresAt: null }],
      ['in checking_manually', { status: TransactionStatus.CheckingManually }],
      ['in dispute', { status: TransactionStatus.Dispute }],
      ['canceled', { status: TransactionStatus.Canceled }],
      ['successful', { status: TransactionStatus.Success }],
    ])(
      'refuses a deal %s with a 409 and moves nothing',
      async (_, overrides) => {
        const built = build();
        const deal = merchantDeal(overrides);
        const before = deal.expiresAt;
        built.manager.findOne.mockResolvedValue(deal);

        await expect(
          built.service.extendTimerByMerchant(MERCHANT, DEAL, NOW),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(deal.expiresAt).toBe(before);
        expect(built.manager.save).not.toHaveBeenCalled();
        expect(built.audit.record).not.toHaveBeenCalled();
      },
    );

    it('extends once: the second call on the same deal is a 409', async () => {
      const built = build();
      const deal = merchantDeal();
      built.manager.findOne.mockResolvedValue(deal);

      await built.service.extendTimerByMerchant(MERCHANT, DEAL, NOW);
      await expect(
        built.service.extendTimerByMerchant(MERCHANT, DEAL, NOW),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(deal.expiresAt).toEqual(new Date('2026-11-04T10:30:00.000Z'));
    });

    it('is a 404 for a deal that is missing or another merchant’s', async () => {
      const built = build();

      await expect(
        built.service.extendTimerByMerchant(MERCHANT, DEAL, NOW),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});

describe('TransactionService.createPayOutRequest', () => {
  const NOW = new Date('2026-11-04T12:00:00.000Z');

  const payOut = (
    overrides: Partial<PayOutRequestInput> = {},
  ): PayOutRequestInput => ({
    method: 'card',
    merchantId: uuidOf(3),
    merchantTransactionId: 'payout-1',
    amountFiat: toFiat(10000),
    rate: toRate(100),
    merchantPercent: 10,
    windowMinutes: null,
    payoutOwnerName: 'PETR PETROV',
    payoutBankId: 7,
    payoutCardNumber: '4111111111111111',
    payoutPhone: null,
    payerInfo: null,
    callbackUrl: null,
    ...overrides,
  });

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('inserts a pending pay-out with no trader, no requisite and no trader pricing, the merchant side fixed', async () => {
    const { service, team, rates, wallets } = build();

    const created = await service.createPayOutRequest(payOut());

    expect(created).toMatchObject({
      kind: TransactionKind.PayOut,
      status: TransactionStatus.Pending,
      method: 'card',
      traderUserId: null,
      merchantId: uuidOf(3),
      merchantTransactionId: 'payout-1',
      merchantPercent: 10,
      payoutOwnerName: 'PETR PETROV',
      payoutBankId: 7,
      payoutCardNumber: '4111111111111111',
      payoutPhone: null,
    });
    expect(created.amountCrypto.toFixed(6)).toBe('100.000000');
    expect(created.merchantCommission.toFixed(6)).toBe('10.000000');
    expect(created.merchantAmount.toFixed(6)).toBe('110.000000');
    for (const field of [
      'bankDetailsId',
      'traderPercent',
      'traderEffectivePercent',
      'traderCommission',
      'traderAmount',
      'leadPercent',
      'leadCommission',
    ] as const) {
      expect(created[field]).toBeUndefined();
    }
    expect(team.assignmentsOf).not.toHaveBeenCalled();
    expect(rates.resolveLeadPercents).not.toHaveBeenCalled();
    expect(wallets.reserveMainEscrowWithin).not.toHaveBeenCalled();
  });

  it('holds the merchant amount after the insert, in the same transaction, and writes the pending event', async () => {
    const { service, merchantBalances, merchantSettings, manager, saved } =
      build();

    const created = await service.createPayOutRequest(payOut());

    expect(merchantBalances.holdPayOutWithin).toHaveBeenCalledWith(
      manager,
      uuidOf(3),
      created.merchantAmount,
      uuidOf(50),
      expect.any(Function),
    );
    expect(manager.save.mock.invocationCallOrder[0]).toBeLessThan(
      merchantBalances.holdPayOutWithin.mock.invocationCallOrder[0],
    );
    expect(saved).toContainEqual(
      expect.objectContaining({
        transactionId: uuidOf(50),
        fromStatus: null,
        toStatus: TransactionStatus.Pending,
        source: StatusEventSource.System,
      }),
    );

    const [, , , , allowsOverdraft] = merchantBalances.holdPayOutWithin.mock
      .calls[0] as unknown as [
      unknown,
      unknown,
      unknown,
      unknown,
      () => Promise<boolean>,
    ];
    await allowsOverdraft();
    expect(merchantSettings.allowsOverdraftWithin).toHaveBeenCalledWith(
      manager,
      uuidOf(3),
    );
  });

  it('lets a refused hold fail the whole pay-out', async () => {
    const { service, merchantBalances } = build();
    merchantBalances.holdPayOutWithin.mockRejectedValueOnce(
      new ConflictException('The merchant balance does not cover the pay-out'),
    );

    await expect(service.createPayOutRequest(payOut())).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('takes the merchant’s timeout first, then the merchant window, then DEAL_TTL_MINUTES', async () => {
    const { service, merchantSettings } = build();

    const timed = await service.createPayOutRequest(
      payOut({ windowMinutes: 30 }),
    );
    expect(timed.createdAt).toEqual(NOW);
    expect(timed.expiresAt).toEqual(new Date(NOW.getTime() + 30 * 60_000));
    expect(merchantSettings.payInWindowMinutesOf).not.toHaveBeenCalled();

    merchantSettings.payInWindowMinutesOf.mockResolvedValueOnce(45);
    expect((await service.createPayOutRequest(payOut())).expiresAt).toEqual(
      new Date(NOW.getTime() + 45 * 60_000),
    );

    expect((await service.createPayOutRequest(payOut())).expiresAt).toEqual(
      new Date(NOW.getTime() + DEAL_TTL_MINUTES * 60_000),
    );
  });

  it('refuses a method without pay-out and a rate finer than its scale before any transaction', async () => {
    const { service, dataSource } = build();

    await expect(
      service.createPayOutRequest(payOut({ method: 'counterparty' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.createPayOutRequest(payOut({ rate: toRate('100.1234567') })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('is canceled back with no trader: the hold returns and no wallet is touched', async () => {
    const { service, manager, merchantBalances, wallets } = build();
    const created = await service.createPayOutRequest(payOut());
    manager.findOne.mockResolvedValueOnce(created);

    const canceled = await service.transition(created.id, {
      toStatus: TransactionStatus.Canceled,
      source: StatusEventSource.AutoTimer,
      reason: 'expired',
    });

    expect(canceled.status).toBe(TransactionStatus.Canceled);
    expect(merchantBalances.releasePayOutWithin).toHaveBeenCalledWith(
      manager,
      uuidOf(3),
      created.id,
    );
    expect(wallets.releaseEscrowWithin).not.toHaveBeenCalled();
    expect(wallets.lockWalletsWithin).not.toHaveBeenCalled();
  });
});
