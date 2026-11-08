import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { toCrypto } from '../../common/utils/to-crypto';
import { toFiat } from '../../common/utils/to-fiat';
import { toRate } from '../../common/utils/to-rate';
import { In, LessThanOrEqual } from 'typeorm';
import { Transaction } from '../entities/transaction.entity';
import { TraderDealActionsService } from '../services/trader-deal-actions.service';
import { DeviceMatchOutcome } from '../types/device-match-outcome.enum';
import { PayInDeclineReason } from '../types/pay-in-decline-reason.enum';
import { StatusEventSource } from '../types/status-event-source.enum';
import { TransactionKind } from '../types/transaction-kind.enum';
import { TransactionStatus } from '../types/transaction-status.enum';

const TRADER = uuidOf(1);
const DEAL = uuidOf(2);
const REQUISITE = uuidOf(3);
const actor = { traderUserId: TRADER, impersonatorUserId: null };

const dealIn = (
  status: TransactionStatus,
  overrides: Partial<Transaction> = {},
): Transaction =>
  ({
    id: DEAL,
    kind: TransactionKind.PayIn,
    status,
    traderUserId: TRADER,
    bankDetailsId: REQUISITE,
    amountFiat: toFiat('1000'),
    amountCrypto: toCrypto('10'),
    rate: toRate('100'),
    merchantPercent: 10,
    traderEffectivePercent: 7,
    merchantCommission: toCrypto('1'),
    traderCommission: toCrypto('0.65'),
    leadCommission: null,
    traderAmount: toCrypto('9.35'),
    merchantAmount: toCrypto('9'),
    ...overrides,
  }) as Transaction;

const build = (deal: Transaction | null, shares: object[] = []) => {
  const manager = {
    findOne: jest.fn(async () => deal),
    find: jest.fn(async () => shares),
    save: jest.fn(async (value: unknown) => value),
  };
  const transactions = {
    transitionLocked: jest.fn(
      async (
        _manager: unknown,
        row: Transaction,
        change: { toStatus: TransactionStatus },
      ) => Object.assign(row, { status: change.toStatus }),
    ),
  };
  const wallets = {
    lockWalletsWithin: jest.fn(async () => []),
    reserveMainEscrowWithin: jest.fn(async () => undefined),
    releaseEscrowWithin: jest.fn(async () => undefined),
  };
  const audit = { record: jest.fn(async () => ({})) };
  const requisites = { disableOwnWithin: jest.fn(async () => undefined) };
  const dataSource = {
    transaction: jest.fn((work: (m: unknown) => unknown) => work(manager)),
  };
  const service = new TraderDealActionsService(
    dataSource as never,
    transactions as never,
    wallets as never,
    audit as never,
    requisites as never,
  );

  return { service, manager, transactions, wallets, audit, requisites };
};

const CONFIRMABLE = [
  TransactionStatus.Active,
  TransactionStatus.Checking,
  TransactionStatus.CheckingManually,
];
const NOT_CONFIRMABLE = [
  TransactionStatus.Dispute,
  TransactionStatus.ManualReview,
  TransactionStatus.Canceled,
];

describe('TraderDealActionsService', () => {
  it('scopes the locked deal to the trader and to pay-in: anything else is a 404', async () => {
    const { service, manager } = build(null);

    await expect(service.confirm(actor, DEAL)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(manager.findOne).toHaveBeenCalledWith(Transaction, {
      where: { id: DEAL, traderUserId: TRADER, kind: TransactionKind.PayIn },
      lock: { mode: 'pessimistic_write' },
    });
  });

  describe('confirm', () => {
    it.each(CONFIRMABLE)(
      'moves %s to success from the trader',
      async (status) => {
        const { service, transactions, audit } = build(dealIn(status));

        const confirmed = await service.confirm(actor, DEAL);

        expect(confirmed.status).toBe(TransactionStatus.Success);
        expect(transactions.transitionLocked.mock.calls[0][2]).toEqual({
          toStatus: TransactionStatus.Success,
          source: StatusEventSource.Trader,
          actorUserId: TRADER,
        });
        expect(audit.record).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'trader.deal_confirmed',
            targetUserId: TRADER,
            metadata: { transactionId: DEAL, fromStatus: status },
          }),
          expect.anything(),
        );
      },
    );

    it('answers a repeat on success without moving anything', async () => {
      const { service, transactions, audit } = build(
        dealIn(TransactionStatus.Success),
      );

      await service.confirm(actor, DEAL);

      expect(transactions.transitionLocked).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it.each([...NOT_CONFIRMABLE, TransactionStatus.SuccessChanged])(
      'refuses %s with a 409',
      async (status) => {
        const { service } = build(dealIn(status));

        await expect(service.confirm(actor, DEAL)).rejects.toBeInstanceOf(
          ConflictException,
        );
      },
    );
  });

  describe('confirmChanged', () => {
    it.each(CONFIRMABLE)(
      'from %s: less returns the surplus and keeps the original figures',
      async (status) => {
        const deal = dealIn(status);
        const { service, wallets, transactions } = build(deal);

        await service.confirmChanged(actor, DEAL, toFiat('500'));

        expect(wallets.releaseEscrowWithin).toHaveBeenCalledTimes(1);
        const [, , released] = wallets.releaseEscrowWithin.mock
          .calls[0] as unknown as [unknown, unknown, typeof deal.traderAmount];
        expect(released.toFixed(6)).toBe(
          toCrypto('9.35').minus(deal.traderAmount).toFixed(6),
        );
        expect(wallets.reserveMainEscrowWithin).not.toHaveBeenCalled();
        expect(deal.originalAmountFiat).toEqual(toFiat('1000'));
        expect(deal.originalTraderAmount).toEqual(toCrypto('9.35'));
        expect(deal.amountFiat).toEqual(toFiat('500'));
        expect(deal.amountCrypto).toEqual(toCrypto('5'));
        expect(deal.merchantAmount).toEqual(toCrypto('4.5'));
        expect(transactions.transitionLocked.mock.calls[0][2]).toEqual({
          toStatus: TransactionStatus.SuccessChanged,
          source: StatusEventSource.Trader,
          actorUserId: TRADER,
        });
      },
    );

    it('the same amount moves no escrow, even on a wallet with nothing available', async () => {
      const { service, wallets } = build(dealIn(TransactionStatus.Active));

      await service.confirmChanged(actor, DEAL, toFiat('1000'));

      expect(wallets.reserveMainEscrowWithin).not.toHaveBeenCalled();
    });

    it('more reserves the difference after locking every wallet', async () => {
      const deal = dealIn(TransactionStatus.Active);
      const { service, wallets } = build(deal);

      await service.confirmChanged(actor, DEAL, toFiat('2000'));

      expect(wallets.reserveMainEscrowWithin).toHaveBeenCalledTimes(1);
      expect(wallets.releaseEscrowWithin).not.toHaveBeenCalled();
      expect(
        wallets.lockWalletsWithin.mock.invocationCallOrder[0],
      ).toBeLessThan(
        wallets.reserveMainEscrowWithin.mock.invocationCallOrder[0],
      );
    });

    it('turns a refused reserve into a 409 INSUFFICIENT_BALANCE and settles nothing', async () => {
      const deal = dealIn(TransactionStatus.Active);
      const { service, wallets, transactions } = build(deal);
      wallets.reserveMainEscrowWithin.mockRejectedValue(
        new ConflictException('Insufficient available balance'),
      );

      const refused = await service
        .confirmChanged(actor, DEAL, toFiat('2000'))
        .catch((error: ConflictException) => error);

      expect(refused).toBeInstanceOf(ConflictException);
      expect((refused as ConflictException).getResponse()).toEqual(
        expect.objectContaining({ code: 'INSUFFICIENT_BALANCE' }),
      );
      expect(transactions.transitionLocked).not.toHaveBeenCalled();
    });

    it('recomputes and saves the lead shares before settling', async () => {
      const shares = [
        { id: 1, leadUserId: uuidOf(9), percent: 1, amount: toCrypto('0.1') },
      ];
      const { service, manager, wallets, transactions } = build(
        dealIn(TransactionStatus.Active),
        shares,
      );

      await service.confirmChanged(actor, DEAL, toFiat('2000'));

      expect(shares[0].amount).toEqual(toCrypto('0.2'));
      expect(wallets.lockWalletsWithin).toHaveBeenCalledWith(
        manager,
        [TRADER, uuidOf(9)],
        [uuidOf(9)],
      );
      expect(manager.save.mock.invocationCallOrder[0]).toBeLessThan(
        transactions.transitionLocked.mock.invocationCallOrder[0],
      );
    });

    it('locks no wallet for a lead whose share is zero: such a lead may have none', async () => {
      const { service, manager, wallets } = build(
        dealIn(TransactionStatus.Active),
        [{ id: 1, leadUserId: uuidOf(9), percent: 0, amount: toCrypto(0) }],
      );

      await service.confirmChanged(actor, DEAL, toFiat('2000'));

      expect(wallets.lockWalletsWithin).toHaveBeenCalledWith(
        manager,
        [TRADER],
        [],
      );
    });

    it('answers a repeat with the same amount and refuses another', async () => {
      const deal = dealIn(TransactionStatus.SuccessChanged, {
        amountFiat: toFiat('500'),
      });
      const { service, transactions } = build(deal);

      await expect(
        service.confirmChanged(actor, DEAL, toFiat('500')),
      ).resolves.toBe(deal);
      await expect(
        service.confirmChanged(actor, DEAL, toFiat('600')),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(transactions.transitionLocked).not.toHaveBeenCalled();
    });

    it.each([...NOT_CONFIRMABLE, TransactionStatus.Success])(
      'refuses %s with a 409',
      async (status) => {
        const { service } = build(dealIn(status));

        await expect(
          service.confirmChanged(actor, DEAL, toFiat('500')),
        ).rejects.toBeInstanceOf(ConflictException);
      },
    );
  });

  describe('decline', () => {
    it('cancels an active deal with the reason, from the trader', async () => {
      const deal = dealIn(TransactionStatus.Active);
      const { service, transactions, requisites, audit } = build(deal);

      await service.decline(actor, DEAL, PayInDeclineReason.LimitReached, null);

      expect(deal.declineReasonCode).toBe(PayInDeclineReason.LimitReached);
      expect(transactions.transitionLocked.mock.calls[0][2]).toEqual({
        toStatus: TransactionStatus.Canceled,
        source: StatusEventSource.Trader,
        actorUserId: TRADER,
        reason: PayInDeclineReason.LimitReached,
      });
      expect(requisites.disableOwnWithin).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'trader.deal_declined' }),
        expect.anything(),
      );
    });

    it('switches the requisite off for requisite_blocked, before any wallet moves', async () => {
      const { service, manager, transactions, requisites } = build(
        dealIn(TransactionStatus.Active),
      );

      await service.decline(
        actor,
        DEAL,
        PayInDeclineReason.RequisiteBlocked,
        null,
      );

      expect(requisites.disableOwnWithin).toHaveBeenCalledWith(
        manager,
        REQUISITE,
        TRADER,
        null,
      );
      expect(
        requisites.disableOwnWithin.mock.invocationCallOrder[0],
      ).toBeLessThan(transactions.transitionLocked.mock.invocationCallOrder[0]);
    });

    it('needs a comment for other', () => {
      const { service } = build(dealIn(TransactionStatus.Active));

      expect(() =>
        service.decline(actor, DEAL, PayInDeclineReason.Other, null),
      ).toThrow(BadRequestException);
    });

    it('declines a deal the payer marked paid (checking) the same way, the requisite switched off for requisite_blocked', async () => {
      const deal = dealIn(TransactionStatus.Checking);
      const { service, transactions, requisites } = build(deal);

      await service.decline(
        actor,
        DEAL,
        PayInDeclineReason.RequisiteBlocked,
        null,
      );

      expect(deal.declineReasonCode).toBe(PayInDeclineReason.RequisiteBlocked);
      expect(requisites.disableOwnWithin).toHaveBeenCalled();
      expect(transactions.transitionLocked.mock.calls[0][2]).toEqual({
        toStatus: TransactionStatus.Canceled,
        source: StatusEventSource.Trader,
        actorUserId: TRADER,
        reason: PayInDeclineReason.RequisiteBlocked,
      });
    });

    it.each([
      TransactionStatus.CheckingManually,
      TransactionStatus.Dispute,
      TransactionStatus.Success,
      TransactionStatus.Canceled,
    ])('refuses %s with a 409', async (status) => {
      const { service, requisites } = build(dealIn(status));

      await expect(
        service.decline(actor, DEAL, PayInDeclineReason.RequisiteBlocked, null),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(requisites.disableOwnWithin).not.toHaveBeenCalled();
    });
  });

  describe('confirmByDeviceWithin', () => {
    const OTHER = uuidOf(4);
    const request = {
      traderUserId: TRADER,
      deviceId: 7,
      messageId: 11,
      bankId: 5,
      amountFiat: toFiat('1000'),
      createdNoLaterThan: new Date('2026-11-08T10:02:00Z'),
      requisites: [
        { id: REQUISITE, bankId: 5 },
        { id: OTHER, bankId: 6 },
      ],
    };

    it('locks the active, checking and checking_manually pay-ins of the trader on the device’s requisites at exactly the amount, created no later than the window', async () => {
      const { service, manager } = build(null);

      await service.confirmByDeviceWithin(manager as never, request);

      expect(manager.find).toHaveBeenCalledWith(Transaction, {
        where: {
          traderUserId: TRADER,
          kind: TransactionKind.PayIn,
          bankDetailsId: In([REQUISITE, OTHER]),
          status: In([
            TransactionStatus.Active,
            TransactionStatus.Checking,
            TransactionStatus.CheckingManually,
          ]),
          amountFiat: request.amountFiat,
          createdAt: LessThanOrEqual(request.createdNoLaterThan),
        },
        order: { id: 'ASC' },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('confirms the one candidate through transitionLocked with source device and audits the message', async () => {
      const deal = dealIn(TransactionStatus.Checking);
      const { service, manager, transactions, audit } = build(null, [deal]);

      const outcome = await service.confirmByDeviceWithin(
        manager as never,
        request,
      );

      expect(outcome).toEqual({
        outcome: DeviceMatchOutcome.Matched,
        transactionId: DEAL,
      });
      expect(transactions.transitionLocked).toHaveBeenCalledWith(
        manager,
        deal,
        {
          toStatus: TransactionStatus.Success,
          source: StatusEventSource.Device,
          actorUserId: TRADER,
        },
      );
      expect(audit.record).toHaveBeenCalledWith(
        {
          actorUserId: TRADER,
          targetUserId: TRADER,
          action: 'device.deal_confirmed',
          metadata: {
            transactionId: DEAL,
            fromStatus: TransactionStatus.Checking,
            deviceId: 7,
            messageId: 11,
            amountFiat: '1000.00',
          },
        },
        manager,
      );
    });

    it('confirms nothing when no deal matches', async () => {
      const { service, manager, transactions } = build(null, []);

      await expect(
        service.confirmByDeviceWithin(manager as never, request),
      ).resolves.toEqual({
        outcome: DeviceMatchOutcome.NoCandidate,
        transactionId: null,
      });
      expect(transactions.transitionLocked).not.toHaveBeenCalled();
    });

    it('confirms nothing when two deals of the amount sit on the device, whatever their banks', async () => {
      const { service, manager, transactions } = build(null, [
        dealIn(TransactionStatus.Active),
        dealIn(TransactionStatus.Active, {
          id: uuidOf(9),
          bankDetailsId: OTHER,
        }),
      ]);

      await expect(
        service.confirmByDeviceWithin(manager as never, request),
      ).resolves.toEqual({
        outcome: DeviceMatchOutcome.Ambiguous,
        transactionId: null,
      });
      expect(transactions.transitionLocked).not.toHaveBeenCalled();
    });

    it('confirms nothing when the one deal sits on a requisite of another bank than the template’s', async () => {
      const { service, manager, transactions } = build(null, [
        dealIn(TransactionStatus.Active, { bankDetailsId: OTHER }),
      ]);

      await expect(
        service.confirmByDeviceWithin(manager as never, request),
      ).resolves.toEqual({
        outcome: DeviceMatchOutcome.BankMismatch,
        transactionId: null,
      });
      expect(transactions.transitionLocked).not.toHaveBeenCalled();
    });

    it('does not query at all for a device with no requisites', async () => {
      const { service, manager } = build(null);

      await expect(
        service.confirmByDeviceWithin(manager as never, {
          ...request,
          requisites: [],
        }),
      ).resolves.toEqual({
        outcome: DeviceMatchOutcome.NoCandidate,
        transactionId: null,
      });
      expect(manager.find).not.toHaveBeenCalled();
    });
  });
});
