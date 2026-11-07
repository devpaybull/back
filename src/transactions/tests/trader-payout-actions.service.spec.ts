import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { toCrypto } from '../../common/utils/to-crypto';
import { toFiat } from '../../common/utils/to-fiat';
import { toRate } from '../../common/utils/to-rate';
import { TraderPayoutActionsService } from '../services/trader-payout-actions.service';
import { PayoutDeclineReason } from '../types/payout-decline-reason.enum';
import { TransactionKind } from '../types/transaction-kind.enum';
import { TransactionStatus } from '../types/transaction-status.enum';

const TRADER = uuidOf(1);
const DEAL = uuidOf(2);
const MERCHANT = uuidOf(3);
const actor = { traderUserId: TRADER, impersonatorUserId: null };
const NOW = new Date('2026-11-07T15:00:00+03:00');
const NIGHT = new Date('2026-11-07T05:00:00+03:00');
const MINUTE = 60_000;

const pending = (overrides: object = {}) => ({
  id: DEAL,
  kind: TransactionKind.PayOut,
  status: TransactionStatus.Pending,
  traderUserId: null,
  merchantId: MERCHANT,
  method: 'card',
  amountFiat: toFiat('9000'),
  amountCrypto: toCrypto('100'),
  rate: toRate('90'),
  merchantPercent: 2,
  expiresAt: new Date(NOW.getTime() + 90 * MINUTE),
  ...overrides,
});

const price = {
  traderPercent: 1,
  traderEffectivePercent: 1,
  shortfallPercent: 0,
  leadPercent: null,
  traderCommission: toCrypto('1'),
  leadCommission: null,
  traderAmount: toCrypto('101'),
  leadShares: [],
};

interface Setup {
  deal?: object | null;
  settings?: object;
  insurance?: string;
  occupied?: string;
  active?: number;
  admission?: object;
  priced?: object | null;
  night?: boolean;
  nightStartHour?: number;
}

const build = (setup: Setup = {}) => {
  const deal = setup.deal === undefined ? pending() : setup.deal;
  const queryBuilder = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getRawOne: jest.fn(async () => ({ sum: setup.occupied ?? '0' })),
  };
  const manager = {
    findOne: jest.fn(async () => deal),
    count: jest.fn(async () => setup.active ?? 0),
    save: jest.fn(async (value: unknown) => value),
    create: jest.fn((_entity: unknown, value: unknown) => value),
    delete: jest.fn(async () => undefined),
    getRepository: jest.fn(() => ({
      createQueryBuilder: () => queryBuilder,
    })),
  };
  const dataSource = {
    manager,
    transaction: jest.fn((work: (m: unknown) => unknown) => work(manager)),
  };
  const transactions = {
    transitionLocked: jest.fn(
      async (_m: unknown, row: object, change: { toStatus: string }) =>
        Object.assign(row, { status: change.toStatus }),
    ),
  };
  const wallets = {
    lockWalletsWithin: jest.fn(async () => [
      { insurancePayOutBalance: toCrypto(setup.insurance ?? '1000') },
    ]),
    isWithinNightWindow: jest.fn(() => setup.night ?? false),
  };
  const audit = { record: jest.fn(async () => ({})) };
  const settings = {
    findOrDefaults: jest.fn(async () => ({
      payoutTradingEnabled: true,
      individualRatesEnabled: false,
      trustedUser: false,
      maxActivePayouts: null,
      ...setup.settings,
    })),
    insurancePayOutMinOf: jest.fn(() => toCrypto('300')),
  };
  const attachments = {
    admissionOf: jest.fn(async () => ({
      exclusiveTopUp: false,
      attachedTraderIds: new Set<string>(),
      switchedOffTraderIds: new Set<string>(),
      ...setup.admission,
    })),
  };
  const pricing = {
    priceFor: jest.fn(async () =>
      setup.priced === undefined ? price : setup.priced,
    ),
  };
  const files = {
    store: jest.fn(async () => ({
      storageKey: 'k',
      name: 'r.pdf',
      mime: 'application/pdf',
      size: 1,
    })),
    discard: jest.fn(async () => undefined),
    recordWithin: jest.fn(async () => ({})),
  };
  const config = {
    get: jest.fn(
      (_key: string, fallback: number) => setup.nightStartHour ?? fallback,
    ),
    getOrThrow: jest.fn(
      (key: string) =>
        ({
          PAYOUT_PAYMENT_WINDOW_MINUTES: 60,
          PAYOUT_MAX_ACTIVE_PER_TRADER: 3,
          PAYOUT_INSURANCE_HOLD_MINUTES: 120,
          BUSINESS_TIMEZONE: 'Europe/Moscow',
        })[key],
    ),
  };
  const service = new TraderPayoutActionsService(
    dataSource as never,
    transactions as never,
    wallets as never,
    audit as never,
    settings as never,
    attachments as never,
    pricing as never,
    files as never,
    config as never,
  );

  return { service, deal, manager, transactions, files, queryBuilder, pricing };
};

const codeOf = (error: unknown): unknown =>
  (error as ConflictException).getResponse?.() &&
  ((error as ConflictException).getResponse() as { code?: string }).code;

describe('TraderPayoutActionsService', () => {
  describe('take', () => {
    it('fixes the trader’s price and the payment deadline, then moves to active', async () => {
      const { service, deal, transactions } = build();

      await service.take(actor, DEAL, NOW);

      expect(deal).toMatchObject({
        traderUserId: TRADER,
        traderPercent: 1,
        traderAmount: toCrypto('101'),
        payoutTakenAt: NOW,
        payoutDeadlineAt: new Date(NOW.getTime() + 60 * MINUTE),
        payoutAssignedBy: 'manual',
      });
      expect(transactions.transitionLocked).toHaveBeenCalledTimes(1);
    });

    it.each([
      [
        'the access is off',
        { settings: { payoutTradingEnabled: false } },
        ForbiddenException,
        'PAYOUTS_ACCESS_DISABLED',
      ],
      [
        'the insurance is below its minimum',
        { insurance: '299.999999' },
        ForbiddenException,
        'INSURANCE_BELOW_MINIMUM',
      ],
      [
        'someone already holds it',
        {
          deal: pending({
            traderUserId: uuidOf(9),
            status: TransactionStatus.Active,
          }),
        },
        ConflictException,
        'ALREADY_TAKEN',
      ],
      [
        'it has expired',
        { deal: pending({ expiresAt: NOW }) },
        ConflictException,
        'ALREADY_TAKEN',
      ],
      [
        'the env limit is reached',
        { active: 3 },
        ConflictException,
        'PAYOUT_ACTIVE_LIMIT',
      ],
      [
        'the personal limit is reached',
        { active: 1, settings: { maxActivePayouts: 1 } },
        ConflictException,
        'PAYOUT_ACTIVE_LIMIT',
      ],
      [
        'there is no price',
        { priced: null },
        ConflictException,
        'RATE_NOT_FOUND',
      ],
      [
        'the insurance room is exceeded',
        { insurance: '400', occupied: '299.000001' },
        ConflictException,
        'PAYOUT_INSURANCE_LIMIT',
      ],
    ])('refuses when %s', async (_name, setup, Exception, code) => {
      const { service, transactions } = build(setup);
      const error = await service
        .take(actor, DEAL, NOW)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(Exception);
      expect(codeOf(error)).toBe(code);
      expect(transactions.transitionLocked).not.toHaveBeenCalled();
    });

    it('lets the amount fit the room exactly, and ignores the room for a trusted trader', async () => {
      await expect(
        build({ insurance: '400', occupied: '299' }).service.take(
          actor,
          DEAL,
          NOW,
        ),
      ).resolves.toBeDefined();
      await expect(
        build({
          insurance: '400',
          occupied: '399',
          settings: { trustedUser: true },
        }).service.take(actor, DEAL, NOW),
      ).resolves.toBeDefined();
    });

    it('the payment deadline runs from the take, past the merchant’s own', async () => {
      const expiresAt = new Date(NOW.getTime() + 5 * MINUTE);
      const { service, deal } = build({ deal: pending({ expiresAt }) });

      await service.take(actor, DEAL, NOW);

      expect(deal).toMatchObject({
        payoutDeadlineAt: new Date(NOW.getTime() + 60 * MINUTE),
      });
    });

    it('a night that starts yesterday counts from yesterday', async () => {
      const night = build({
        night: true,
        nightStartHour: 22,
        deal: pending({ expiresAt: new Date(NIGHT.getTime() + MINUTE) }),
      });

      await night.service.take(actor, DEAL, NIGHT);

      expect(night.queryBuilder.andWhere).toHaveBeenCalledWith(
        'transaction.payoutTakenAt >= :since',
        { since: new Date('2026-11-06T22:00:00+03:00') },
      );
    });

    it.each([
      ['exclusive and not attached', { exclusiveTopUp: true }],
      ['switched off', { switchedOffTraderIds: new Set([TRADER]) }],
    ])('hides a merchant that is %s behind a 404', async (_name, admission) => {
      await expect(
        build({ admission }).service.take(actor, DEAL, NOW),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('a 404 for what is not a pay-out', async () => {
      await expect(
        build({ deal: null }).service.take(actor, DEAL, NOW),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('the hold window by day, and the start of the night when that is earlier', async () => {
      const day = build();
      await day.service.take(actor, DEAL, NOW);
      expect(day.queryBuilder.andWhere).toHaveBeenCalledWith(
        'transaction.payoutTakenAt >= :since',
        { since: new Date(NOW.getTime() - 120 * MINUTE) },
      );

      const night = build({
        night: true,
        deal: pending({ expiresAt: new Date(NIGHT.getTime() + MINUTE) }),
      });
      await night.service.take(actor, DEAL, NIGHT);
      expect(night.queryBuilder.andWhere).toHaveBeenCalledWith(
        'transaction.payoutTakenAt >= :since',
        { since: new Date('2026-11-07T00:00:00+03:00') },
      );
    });
  });

  describe('complete', () => {
    const active = () =>
      pending({ status: TransactionStatus.Active, traderUserId: TRADER });
    const upload = { buffer: Buffer.from('%PDF-'), name: 'r.pdf' };

    it('stores the receipt, then moves to checking with the time of it', async () => {
      const { service, deal, files, transactions } = build({ deal: active() });

      await service.complete(actor, DEAL, upload, NOW);

      expect(files.recordWithin).toHaveBeenCalledTimes(1);
      expect(deal).toMatchObject({ payoutCompletedAt: NOW });
      expect(transactions.transitionLocked.mock.calls[0][2]).toMatchObject({
        toStatus: TransactionStatus.Checking,
      });
    });

    it('stores nothing unless it is in work', async () => {
      const { service, files } = build({
        deal: pending({
          status: TransactionStatus.Checking,
          traderUserId: TRADER,
        }),
      });

      await expect(
        service.complete(actor, DEAL, upload, NOW),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(files.store).not.toHaveBeenCalled();
    });

    it('deletes the stored object when the transaction fails', async () => {
      const { service, files, transactions } = build({ deal: active() });
      transactions.transitionLocked.mockRejectedValue(new Error('boom'));

      await expect(service.complete(actor, DEAL, upload, NOW)).rejects.toThrow(
        'boom',
      );
      expect(files.discard).toHaveBeenCalledTimes(1);
    });
  });

  describe('decline', () => {
    it('needs a comment for other', () => {
      expect(() =>
        build().service.decline(actor, DEAL, PayoutDeclineReason.Other, null),
      ).toThrow(BadRequestException);
    });

    it('clears the trader, the price and the shares, and journals the decline', async () => {
      const { service, deal, manager } = build({
        deal: pending({
          status: TransactionStatus.Active,
          traderUserId: TRADER,
          traderAmount: toCrypto('101'),
          payoutDeadlineAt: NOW,
        }),
      });

      await service.decline(actor, DEAL, PayoutDeclineReason.Technical, null);

      expect(deal).toMatchObject({
        status: TransactionStatus.Pending,
        traderUserId: null,
        traderAmount: null,
        payoutDeadlineAt: null,
      });
      expect(manager.delete).toHaveBeenCalledTimes(1);
      expect(manager.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          traderUserId: TRADER,
          reasonCode: PayoutDeclineReason.Technical,
        }),
      );
    });
  });
});
