import { BadRequestException, NotFoundException } from '@nestjs/common';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { Crypto } from '../../common/types/crypto';
import { roundCrypto } from '../../common/utils/round-crypto';
import { toCrypto } from '../../common/utils/to-crypto';
import { toFiat } from '../../common/utils/to-fiat';
import { toRate } from '../../common/utils/to-rate';
import { TransactionDispute } from '../entities/transaction-dispute.entity';
import { TransactionStatusEvent } from '../entities/transaction-status-event.entity';
import { AdminDealActionsService } from '../services/admin-deal-actions.service';
import { StatusEventSource } from '../types/status-event-source.enum';
import { TransactionKind } from '../types/transaction-kind.enum';
import { TransactionStatus } from '../types/transaction-status.enum';
import { recomputeChangedDeal } from '../utils/recompute-changed-deal';

const TRADER = uuidOf(1);
const LEAD = uuidOf(2);
const MERCHANT = uuidOf(3);
const DEAL = uuidOf(4);
const ADMIN = { userId: uuidOf(9) };

const settledPayIn = (overrides: object = {}) => ({
  id: DEAL,
  kind: TransactionKind.PayIn,
  status: TransactionStatus.Success,
  method: 'sbp',
  traderUserId: TRADER,
  merchantId: MERCHANT,
  counterpartyId: null,
  amountFiat: toFiat('1000'),
  amountCrypto: toCrypto('10'),
  rate: toRate('100'),
  merchantPercent: 10,
  traderEffectivePercent: 7,
  merchantCommission: toCrypto('1'),
  traderCommission: toCrypto('0.654206'),
  leadCommission: toCrypto('0.1'),
  traderAmount: toCrypto('9.345794'),
  merchantAmount: toCrypto('9'),
  originalAmountFiat: null,
  originalAmountCrypto: null,
  originalMerchantCommission: null,
  originalTraderCommission: null,
  originalLeadCommission: null,
  originalTraderAmount: null,
  originalMerchantAmount: null,
  resolvedAt: new Date('2026-11-10T10:00:00Z'),
  ...overrides,
});

interface Setup {
  deal?: object | null;
  mains?: Record<string, string>;
  reserved?: Record<string, string>;
  merchantBalance?: string;
  liveDispute?: boolean;
  paidBefore?: boolean;
  credited?: boolean;
  callbackState?: { queued: boolean; recent: boolean };
  merchantCallbackUrl?: string | null;
}

const build = (setup: Setup = {}) => {
  const deal = setup.deal === undefined ? settledPayIn() : setup.deal;
  const shares = [
    { id: 1, leadUserId: LEAD, percent: 1, amount: toCrypto('0.1') },
  ];
  const manager = {
    findOne: jest.fn(async () => deal),
    find: jest.fn(async () => shares),
    exists: jest.fn(async (entity: unknown) =>
      entity === TransactionDispute
        ? (setup.liveDispute ?? false)
        : entity === TransactionStatusEvent
          ? (setup.paidBefore ?? false)
          : false,
    ),
    save: jest.fn(async (value: unknown) => value),
  };
  const dataSource = {
    transaction: jest.fn((work: (m: unknown) => unknown) => work(manager)),
  };
  const transactions = {
    transitionLocked: jest.fn(
      async (_m: unknown, row: object, change: { toStatus: string }) =>
        Object.assign(row, { status: change.toStatus }),
    ),
    recordEventWithin: jest.fn(async () => undefined),
  };
  const mains = setup.mains ?? {};
  const reserved = setup.reserved ?? {};
  const wallets = {
    lockWalletsWithin: jest.fn(async (_m: unknown, ids: string[]) =>
      ids.map((userId) => ({
        userId,
        mainBalance: toCrypto(mains[userId] ?? '1000'),
        mainReserved: toCrypto(reserved[userId] ?? '0'),
      })),
    ),
    getAvailableMain: jest.fn(
      (wallet: { mainBalance: Crypto; mainReserved: Crypto }) =>
        roundCrypto(wallet.mainBalance.minus(wallet.mainReserved)),
    ),
    adjustMainWithin: jest.fn(async () => undefined),
  };
  const merchantBalances = {
    lockBalanceWithin: jest.fn(async () => ({
      balance: toCrypto(setup.merchantBalance ?? '1000'),
    })),
    creditDealWithin: jest.fn(async () => (setup.credited ? {} : null)),
    correctDealWithin: jest.fn(async () => ({})),
  };
  const counterpartyStats = {
    recordDisputePaidWithin: jest.fn(async () => undefined),
  };
  const dealCallbacks = { recordWithin: jest.fn(async () => ({ id: 'cb' })) };
  const callbacks = {
    deliveryStateWithin: jest.fn(
      async () => setup.callbackState ?? { queued: false, recent: false },
    ),
  };
  const merchantSettings = {
    callbackUrlWithin: jest.fn(async () =>
      setup.merchantCallbackUrl === undefined
        ? 'https://m.example/cb'
        : setup.merchantCallbackUrl,
    ),
  };
  const audit = { record: jest.fn(async () => ({})) };

  return {
    deal: deal as ReturnType<typeof settledPayIn>,
    shares,
    manager,
    transactions,
    wallets,
    merchantBalances,
    counterpartyStats,
    dealCallbacks,
    audit,
    service: new AdminDealActionsService(
      dataSource as never,
      transactions as never,
      wallets as never,
      merchantBalances as never,
      counterpartyStats as never,
      dealCallbacks as never,
      audit as never,
      callbacks as never,
      merchantSettings as never,
    ),
  };
};

const codeOf = (error: unknown): unknown =>
  (
    (error as { getResponse?: () => unknown }).getResponse?.() as
      { code?: string } | undefined
  )?.code;

const moved = (
  wallets: ReturnType<typeof build>['wallets'],
  userId: string,
): Crypto | undefined =>
  (wallets.adjustMainWithin.mock.calls as unknown[][]).find(
    (call) => call[1] === userId,
  )?.[2] as Crypto | undefined;

const correction = { reason: 'чек клиента', confirmOverdraft: false };

describe('AdminDealActionsService', () => {
  describe('close', () => {
    it('confirms an open pay-in as the admin', async () => {
      const { service, deal, transactions, audit } = build({
        deal: settledPayIn({ status: TransactionStatus.Checking }),
      });

      await service.close(ADMIN, DEAL);

      expect(transactions.transitionLocked).toHaveBeenCalledWith(
        expect.anything(),
        deal,
        {
          toStatus: TransactionStatus.Success,
          source: StatusEventSource.Admin,
          actorUserId: ADMIN.userId,
        },
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'admin.deal_closed' }),
        expect.anything(),
      );
    });

    it('refuses a pay-out, a settled deal, a deal under dispute, and an unknown one', async () => {
      const payOut = await build({
        deal: settledPayIn({
          kind: TransactionKind.PayOut,
          status: TransactionStatus.Active,
        }),
      })
        .service.close(ADMIN, DEAL)
        .catch((error: unknown) => error);
      expect(codeOf(payOut)).toBe('DEAL_NOT_CLOSABLE');

      const settled = await build()
        .service.close(ADMIN, DEAL)
        .catch((error: unknown) => error);
      expect(codeOf(settled)).toBe('DEAL_NOT_CLOSABLE');

      const disputed = await build({
        deal: settledPayIn({ status: TransactionStatus.Active }),
        liveDispute: true,
      })
        .service.close(ADMIN, DEAL)
        .catch((error: unknown) => error);
      expect(codeOf(disputed)).toBe('DEAL_UNDER_DISPUTE');

      await expect(
        build({ deal: null }).service.close(ADMIN, DEAL),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('changeAmount', () => {
    it('reprices a pay-in and moves only the difference for every side', async () => {
      const { service, deal, wallets, merchantBalances, shares } = build();
      const before = settledPayIn();
      const figures = recomputeChangedDeal(before, shares, toFiat('1500'));

      await service.changeAmount(ADMIN, DEAL, {
        ...correction,
        amountFiat: toFiat('1500'),
      });

      expect(moved(wallets, TRADER)).toEqual(
        roundCrypto(before.traderAmount.minus(figures.traderAmount)),
      );
      expect(moved(wallets, LEAD)).toEqual(
        roundCrypto(figures.leadShares[0].amount.minus(toCrypto('0.1'))),
      );
      expect(merchantBalances.correctDealWithin).toHaveBeenCalledWith(
        expect.anything(),
        MERCHANT,
        roundCrypto(figures.merchantAmount.minus(before.merchantAmount)),
        DEAL,
        ADMIN.userId,
      );
      expect(deal).toMatchObject({
        status: TransactionStatus.SuccessChanged,
        amountFiat: toFiat('1500'),
        originalAmountFiat: toFiat('1000'),
        originalTraderAmount: before.traderAmount,
        traderAmount: figures.traderAmount,
      });
    });

    it('keeps the first original amount when changed again', async () => {
      const { service, deal } = build({
        deal: settledPayIn({
          status: TransactionStatus.SuccessChanged,
          originalAmountFiat: toFiat('800'),
        }),
      });

      await service.changeAmount(ADMIN, DEAL, {
        ...correction,
        amountFiat: toFiat('900'),
      });

      expect(deal.originalAmountFiat).toEqual(toFiat('800'));
    });

    it('a pay-out credits the trader and charges the merchant for more', async () => {
      const payOut = settledPayIn({ kind: TransactionKind.PayOut });
      const { service, wallets, merchantBalances } = build({ deal: payOut });
      const figures = recomputeChangedDeal(
        settledPayIn({ kind: TransactionKind.PayOut }),
        [],
        toFiat('2000'),
      );

      await service.changeAmount(ADMIN, DEAL, {
        ...correction,
        amountFiat: toFiat('2000'),
      });

      expect(moved(wallets, TRADER)?.gt(0)).toBe(true);
      expect(moved(wallets, TRADER)).toEqual(
        roundCrypto(figures.traderAmount.minus(toCrypto('9.345794'))),
      );
      const merchantDelta = (
        merchantBalances.correctDealWithin.mock.calls[0] as unknown[]
      )[2] as Crypto;
      expect(merchantDelta.lt(0)).toBe(true);
    });

    it('refuses the same amount, an unsettled deal and a live dispute', async () => {
      await expect(
        build().service.changeAmount(ADMIN, DEAL, {
          ...correction,
          amountFiat: toFiat('1000'),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      const active = await build({
        deal: settledPayIn({ status: TransactionStatus.Active }),
      })
        .service.changeAmount(ADMIN, DEAL, {
          ...correction,
          amountFiat: toFiat('1500'),
        })
        .catch((error: unknown) => error);
      expect(codeOf(active)).toBe('DEAL_NOT_SETTLED');

      const disputed = await build({ liveDispute: true })
        .service.changeAmount(ADMIN, DEAL, {
          ...correction,
          amountFiat: toFiat('1500'),
        })
        .catch((error: unknown) => error);
      expect(codeOf(disputed)).toBe('DEAL_UNDER_DISPUTE');
    });

    it('a lower amount the merchant cannot give back needs the overdraft confirmed', async () => {
      const short = build({ merchantBalance: '1' });
      const refused = await short.service
        .changeAmount(ADMIN, DEAL, { ...correction, amountFiat: toFiat('100') })
        .catch((error: unknown) => error);

      expect(codeOf(refused)).toBe('OVERDRAFT_NOT_CONFIRMED');
      expect(
        (
          refused as { getResponse: () => { shortfalls: object[] } }
        ).getResponse().shortfalls,
      ).toEqual([expect.objectContaining({ party: 'merchant', id: MERCHANT })]);
      expect(short.wallets.adjustMainWithin).not.toHaveBeenCalled();
      expect(short.merchantBalances.correctDealWithin).not.toHaveBeenCalled();

      const confirmed = build({ merchantBalance: '1' });
      await confirmed.service.changeAmount(ADMIN, DEAL, {
        reason: 'x',
        confirmOverdraft: true,
        amountFiat: toFiat('100'),
      });
      expect(confirmed.merchantBalances.correctDealWithin).toHaveBeenCalled();
    });

    it('moves the counterparty’s paid amount by the difference', async () => {
      const { service, counterpartyStats } = build({
        deal: settledPayIn({ counterpartyId: 5 }),
      });

      await service.changeAmount(ADMIN, DEAL, {
        ...correction,
        amountFiat: toFiat('1200'),
      });

      expect(counterpartyStats.recordDisputePaidWithin).toHaveBeenCalledWith(
        expect.anything(),
        5,
        expect.objectContaining({
          newlyPaid: false,
          amountFiat: toFiat('200'),
        }),
      );
    });
  });

  describe('cancelSettled', () => {
    it('reverses a pay-in: the trader gets back, the merchant and the lead give back', async () => {
      const { service, deal, wallets, merchantBalances, transactions } =
        build();

      await service.cancelSettled(ADMIN, DEAL, correction);

      expect(moved(wallets, TRADER)).toEqual(toCrypto('9.345794'));
      expect(moved(wallets, LEAD)).toEqual(toCrypto('-0.1'));
      expect(merchantBalances.correctDealWithin).toHaveBeenCalledWith(
        expect.anything(),
        MERCHANT,
        toCrypto('-9'),
        DEAL,
        ADMIN.userId,
      );
      expect(deal.status).toBe(TransactionStatus.Canceled);
      expect(transactions.recordEventWithin).toHaveBeenCalledWith(
        expect.anything(),
        DEAL,
        TransactionStatus.Success,
        expect.objectContaining({
          toStatus: TransactionStatus.Canceled,
          source: StatusEventSource.Admin,
          reason: correction.reason,
        }),
      );
    });

    it('reverses a pay-out the other way round', async () => {
      const { service, wallets, merchantBalances } = build({
        deal: settledPayIn({ kind: TransactionKind.PayOut }),
      });

      await service.cancelSettled(ADMIN, DEAL, correction);

      expect(moved(wallets, TRADER)).toEqual(toCrypto('-9.345794'));
      expect(merchantBalances.correctDealWithin).toHaveBeenCalledWith(
        expect.anything(),
        MERCHANT,
        toCrypto('9'),
        DEAL,
        ADMIN.userId,
      );
    });

    it('a trader who already spent the money needs the overdraft confirmed', async () => {
      const refused = await build({
        deal: settledPayIn({ kind: TransactionKind.PayOut }),
        mains: { [TRADER]: '1' },
      })
        .service.cancelSettled(ADMIN, DEAL, correction)
        .catch((error: unknown) => error);

      expect(codeOf(refused)).toBe('OVERDRAFT_NOT_CONFIRMED');
    });

    it('refuses what is not settled', async () => {
      const refused = await build({
        deal: settledPayIn({ status: TransactionStatus.Canceled }),
      })
        .service.cancelSettled(ADMIN, DEAL, correction)
        .catch((error: unknown) => error);

      expect(codeOf(refused)).toBe('DEAL_NOT_SETTLED');
    });
  });

  describe('restore', () => {
    const canceled = (overrides: object = {}) =>
      settledPayIn({ status: TransactionStatus.Canceled, ...overrides });

    it('settles a canceled pay-in: the trader pays, the merchant gets the deal credit', async () => {
      const { service, deal, wallets, merchantBalances } = build({
        deal: canceled(),
        credited: true,
      });

      await service.restore(ADMIN, DEAL, correction);

      expect(moved(wallets, TRADER)).toEqual(toCrypto('-9.345794'));
      expect(moved(wallets, LEAD)).toEqual(toCrypto('0.1'));
      expect(merchantBalances.creditDealWithin).toHaveBeenCalledWith(
        expect.anything(),
        MERCHANT,
        toCrypto('9'),
        DEAL,
      );
      expect(merchantBalances.correctDealWithin).not.toHaveBeenCalled();
      expect(deal.status).toBe(TransactionStatus.Success);
    });

    it('a deal credited once already gets a correction, and keeps a changed status', async () => {
      const { service, deal, merchantBalances } = build({
        deal: canceled({ originalAmountFiat: toFiat('900') }),
        credited: false,
      });

      await service.restore(ADMIN, DEAL, correction);

      expect(merchantBalances.correctDealWithin).toHaveBeenCalled();
      expect(deal.status).toBe(TransactionStatus.SuccessChanged);
    });

    it('counts the client as paid only the first time', async () => {
      const first = build({ deal: canceled({ counterpartyId: 5 }) });
      await first.service.restore(ADMIN, DEAL, correction);
      expect(
        first.counterpartyStats.recordDisputePaidWithin,
      ).toHaveBeenCalledWith(
        expect.anything(),
        5,
        expect.objectContaining({
          newlyPaid: true,
          amountFiat: toFiat('1000'),
        }),
      );

      const again = build({
        deal: canceled({ counterpartyId: 5 }),
        paidBefore: true,
      });
      await again.service.restore(ADMIN, DEAL, correction);
      expect(
        again.counterpartyStats.recordDisputePaidWithin,
      ).toHaveBeenCalledWith(
        expect.anything(),
        5,
        expect.objectContaining({ newlyPaid: false, amountFiat: toFiat(0) }),
      );
    });

    it('a trader short of main needs the overdraft confirmed; a pay-out is not restored', async () => {
      const short = await build({
        deal: canceled(),
        mains: { [TRADER]: '1' },
      })
        .service.restore(ADMIN, DEAL, correction)
        .catch((error: unknown) => error);
      expect(codeOf(short)).toBe('OVERDRAFT_NOT_CONFIRMED');

      const payOut = await build({
        deal: canceled({ kind: TransactionKind.PayOut }),
      })
        .service.restore(ADMIN, DEAL, correction)
        .catch((error: unknown) => error);
      expect(codeOf(payOut)).toBe('DEAL_NOT_RESTORABLE');
    });
  });

  describe('cancelPayout', () => {
    it('cancels a pending or taken pay-out through the status graph', async () => {
      for (const status of [
        TransactionStatus.Pending,
        TransactionStatus.Active,
      ]) {
        const { service, deal, transactions } = build({
          deal: settledPayIn({ kind: TransactionKind.PayOut, status }),
        });

        await service.cancelPayout(ADMIN, DEAL, 'просьба мерчанта');

        expect(transactions.transitionLocked).toHaveBeenCalledWith(
          expect.anything(),
          deal,
          expect.objectContaining({
            toStatus: TransactionStatus.Canceled,
            source: StatusEventSource.Admin,
          }),
        );
      }
    });

    it('refuses a pay-in and a pay-out in review', async () => {
      for (const deal of [
        settledPayIn({ status: TransactionStatus.Active }),
        settledPayIn({
          kind: TransactionKind.PayOut,
          status: TransactionStatus.Checking,
        }),
      ]) {
        const refused = await build({ deal })
          .service.cancelPayout(ADMIN, DEAL, null)
          .catch((error: unknown) => error);

        expect(codeOf(refused)).toBe('PAYOUT_NOT_CANCELABLE');
      }
    });
  });

  describe('sendCallback', () => {
    const fromApi = (overrides: object = {}) =>
      settledPayIn({
        merchantTransactionId: 'order-1',
        callbackUrl: null,
        ...overrides,
      });

    it('queues the deal’s current state, falling back to the merchant’s address', async () => {
      const { service, deal, dealCallbacks, audit } = build({
        deal: fromApi(),
      });

      const callback = await service.sendCallback(ADMIN, DEAL);

      expect(callback).toEqual({ id: 'cb' });
      expect(dealCallbacks.recordWithin).toHaveBeenCalledWith(
        expect.anything(),
        deal,
        'status_changed',
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'admin.callback_sent' }),
        expect.anything(),
      );
    });

    it('refuses a deal with no address: not from /v1, or no URL anywhere', async () => {
      for (const setup of [
        { deal: settledPayIn({ merchantTransactionId: null }) },
        { deal: fromApi(), merchantCallbackUrl: null },
      ]) {
        const refused = await build(setup)
          .service.sendCallback(ADMIN, DEAL)
          .catch((error: unknown) => error);

        expect(codeOf(refused)).toBe('NO_CALLBACK_URL');
      }
    });

    it('a queued callback is a 409, one sent within a minute a 429', async () => {
      const queued = await build({
        deal: fromApi(),
        callbackState: { queued: true, recent: true },
      })
        .service.sendCallback(ADMIN, DEAL)
        .catch((error: unknown) => error);
      expect(codeOf(queued)).toBe('CALLBACK_QUEUED');

      const recent = await build({
        deal: fromApi(),
        callbackState: { queued: false, recent: true },
      })
        .service.sendCallback(ADMIN, DEAL)
        .catch((error: unknown) => error);
      expect((recent as { getStatus: () => number }).getStatus()).toBe(429);
    });
  });

  it('counts the trader’s escrow: main that covers the debit but not the reserve is an overdraft', async () => {
    const refused = await build({
      deal: settledPayIn({ status: TransactionStatus.Canceled }),
      mains: { [TRADER]: '100' },
      reserved: { [TRADER]: '95' },
    })
      .service.restore(ADMIN, DEAL, correction)
      .catch((error: unknown) => error);

    expect(codeOf(refused)).toBe('OVERDRAFT_NOT_CONFIRMED');
  });
});
