import { SortOrder } from '../../common/enums/sort-order.enum';
import { Page } from '../../common/types/page';
import { TraderSettings } from '../../trader-settings/entities/trader-settings.entity';
import { TransactionSortField } from '../types/transaction-sort-field.enum';
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
import { Role } from '../../common/enums/role.enum';
import { UserStatus } from '../../users/types/user-status.enum';
import { StatusEventSource } from '../types/status-event-source.enum';

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
  user?: object | null;
  merchantBalance?: string;
  liveDispute?: boolean;
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
    exists: jest.fn(async () => setup.liveDispute ?? false),
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
    recordEventWithin: jest.fn(async () => undefined),
  };
  const users = {
    findByIds: jest.fn(async () =>
      setup.user === null
        ? []
        : [
            {
              id: TRADER,
              role: Role.Trader,
              status: UserStatus.Active,
              ...setup.user,
            },
          ],
    ),
  };
  const merchantBalances = {
    lockBalanceWithin: jest.fn(async () => ({
      balance: toCrypto(setup.merchantBalance ?? '1000'),
    })),
    reholdPayOutWithin: jest.fn(async () => ({})),
  };
  const merchantSettings = {
    payInWindowMinutesOf: jest.fn(async () => 30),
  };
  const dealCallbacks = { recordWithin: jest.fn(async () => undefined) };
  const wallets = {
    lockWalletsWithin: jest.fn(async () => [
      { insurancePayOutBalance: toCrypto(setup.insurance ?? '1000') },
    ]),
    isWithinNightWindow: jest.fn(() => setup.night ?? false),
    stampAcceptedDealWithin: jest.fn(async () => undefined),
    findByUserId: jest.fn(async () => ({
      insurancePayOutBalance: toCrypto(setup.insurance ?? '1000'),
    })),
  };
  const audit = { record: jest.fn(async () => ({})) };
  const settings = {
    findOrDefaults: jest.fn(async () => ({
      payoutTradingEnabled: true,
      tradingEnabled: true,
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
    exclusionsOfTrader: jest.fn(async () => ({ exclusiveMerchantIds: [] })),
  };
  const payouts = {
    pool: jest.fn(
      async () => new Page([], { total: 3, page: 1, limit: 1, pages: 3 }),
    ),
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
    payouts as never,
    users as never,
    merchantBalances as never,
    merchantSettings as never,
    dealCallbacks as never,
  );

  return {
    service,
    deal,
    manager,
    transactions,
    files,
    queryBuilder,
    pricing,
    wallets,
    payouts,
    attachments,
    audit,
    merchantBalances,
    dealCallbacks,
  };
};

const codeOf = (error: unknown): unknown =>
  (error as ConflictException).getResponse?.() &&
  ((error as ConflictException).getResponse() as { code?: string }).code;

describe('TraderPayoutActionsService', () => {
  describe('the pool', () => {
    const query = {
      page: 1,
      limit: 1,
      sortBy: TransactionSortField.CreatedAt,
      sortOrder: SortOrder.Desc,
    };
    const settingsOf = (overrides: Partial<TraderSettings>) =>
      ({
        payoutTradingEnabled: true,
        tradingEnabled: true,
        trustedUser: false,
        ...overrides,
      }) as TraderSettings;

    it('is closed by the access first, then by the trading switch', () => {
      const { service } = build();

      expect.assertions(3);
      for (const [settings, code] of [
        [
          settingsOf({ payoutTradingEnabled: false, tradingEnabled: false }),
          'PAYOUTS_ACCESS_DISABLED',
        ],
        [settingsOf({ tradingEnabled: false }), 'TRADING_DISABLED'],
      ] as const) {
        try {
          service.assertPoolOpen(settings);
        } catch (error) {
          expect(codeOf(error)).toBe(code);
        }
      }
      expect(() => service.assertPoolOpen(settingsOf({}))).not.toThrow();
    });

    it('is empty below the insurance minimum, without asking for the pool', async () => {
      const { service, payouts } = build({ insurance: '100' });

      const page = await service.poolOf(TRADER, settingsOf({}), query, NOW);

      expect(page.meta.total).toBe(0);
      expect(payouts.pool).not.toHaveBeenCalled();
    });

    it('is limited by the room of a Standard trader and not of a trusted one', async () => {
      const standard = build({ insurance: '1000', occupied: '400' });

      await standard.service.poolOf(TRADER, settingsOf({}), query, NOW);

      expect(standard.payouts.pool).toHaveBeenCalledWith(
        query,
        expect.anything(),
        toCrypto('600'),
        NOW,
      );

      const trusted = build({ insurance: '1000', occupied: '400' });

      await trusted.service.poolOf(
        TRADER,
        settingsOf({ trustedUser: true }),
        query,
        NOW,
      );

      expect(trusted.payouts.pool).toHaveBeenCalledWith(
        query,
        expect.anything(),
        null,
        NOW,
      );
    });
  });

  describe('take', () => {
    it('stamps the last accepted deal for the 14-day insurance rule', async () => {
      const { service, wallets, manager } = build();

      await service.take(actor, DEAL, NOW);

      expect(wallets.stampAcceptedDealWithin).toHaveBeenCalledWith(
        manager,
        TRADER,
        NOW,
      );
    });

    it('refuses while the trading switch is off, and stamps nothing', async () => {
      const { service, wallets } = build({
        settings: { tradingEnabled: false },
      });

      const error = await service.take(actor, DEAL, NOW).catch((e) => e);

      expect(codeOf(error)).toBe('TRADING_DISABLED');
      expect(wallets.stampAcceptedDealWithin).not.toHaveBeenCalled();
    });

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

  describe('assignment by an admin', () => {
    const ADMIN = { userId: uuidOf(9) };
    const assign = { traderUserId: TRADER, confirmOverdraft: false };

    it('takes a pool pay-out for the trader, marked as the admin’s', async () => {
      const { service, deal, transactions, audit } = build();

      await service.assignByAdmin(ADMIN, DEAL, assign, NOW);

      expect(deal).toMatchObject({
        traderUserId: TRADER,
        payoutAssignedBy: 'admin',
        status: TransactionStatus.Active,
      });
      expect(transactions.transitionLocked).toHaveBeenCalledWith(
        expect.anything(),
        deal,
        {
          toStatus: TransactionStatus.Active,
          source: StatusEventSource.Admin,
          actorUserId: ADMIN.userId,
        },
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: ADMIN.userId,
          targetUserId: TRADER,
          action: 'admin.payout_assigned',
        }),
        expect.anything(),
      );
    });

    it('refuses anybody who is not an active trader', async () => {
      for (const user of [
        null,
        { role: Role.LeadTrader },
        { status: UserStatus.Blocked },
      ]) {
        await expect(
          build({ user }).service.assignByAdmin(ADMIN, DEAL, assign, NOW),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
    });

    it('keeps the take’s checks: the switch, the admission, the insurance', async () => {
      await expect(
        build({ settings: { tradingEnabled: false } }).service.assignByAdmin(
          ADMIN,
          DEAL,
          assign,
          NOW,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      const notAdmitted = await build({ admission: { exclusiveTopUp: true } })
        .service.assignByAdmin(ADMIN, DEAL, assign, NOW)
        .catch((error: unknown) => error);
      expect(codeOf(notAdmitted)).toBe('TRADER_NOT_ADMITTED');

      const poor = await build({ insurance: '10' })
        .service.assignByAdmin(ADMIN, DEAL, assign, NOW)
        .catch((error: unknown) => error);
      expect(codeOf(poor)).toBe('INSURANCE_BELOW_MINIMUM');
    });

    it('revives a canceled pay-out: holds the merchant again and opens a new window', async () => {
      const canceled = pending({
        status: TransactionStatus.Canceled,
        merchantAmount: toCrypto('102'),
        resolvedAt: NOW,
      });
      const { service, deal, merchantBalances, manager, dealCallbacks } = build(
        { deal: canceled },
      );

      await service.assignByAdmin(ADMIN, DEAL, assign, NOW);

      expect(manager.delete).toHaveBeenCalled();
      expect(merchantBalances.reholdPayOutWithin).toHaveBeenCalledWith(
        manager,
        MERCHANT,
        toCrypto('102'),
        DEAL,
        ADMIN.userId,
      );
      expect(deal).toMatchObject({
        status: TransactionStatus.Active,
        resolvedAt: null,
        traderUserId: TRADER,
        expiresAt: new Date(NOW.getTime() + 30 * MINUTE),
      });
      expect(dealCallbacks.recordWithin).toHaveBeenCalled();
    });

    it('a revival the merchant cannot cover needs the overdraft confirmed', async () => {
      const canceled = () =>
        pending({
          status: TransactionStatus.Canceled,
          merchantAmount: toCrypto('102'),
        });
      const short = build({ deal: canceled(), merchantBalance: '50' });
      const refused = await short.service
        .assignByAdmin(ADMIN, DEAL, assign, NOW)
        .catch((error: unknown) => error);

      expect(codeOf(refused)).toBe('OVERDRAFT_NOT_CONFIRMED');
      expect(short.merchantBalances.reholdPayOutWithin).not.toHaveBeenCalled();

      const confirmed = build({ deal: canceled(), merchantBalance: '50' });
      await confirmed.service.assignByAdmin(
        ADMIN,
        DEAL,
        { ...assign, confirmOverdraft: true },
        NOW,
      );
      expect(confirmed.merchantBalances.reholdPayOutWithin).toHaveBeenCalled();
    });

    it('a live dispute blocks a revival; a trader never takes a canceled one', async () => {
      const canceled = pending({ status: TransactionStatus.Canceled });
      const disputed = await build({ deal: canceled, liveDispute: true })
        .service.assignByAdmin(ADMIN, DEAL, assign, NOW)
        .catch((error: unknown) => error);
      expect(codeOf(disputed)).toBe('DEAL_UNDER_DISPUTE');

      const taken = await build({
        deal: pending({ status: TransactionStatus.Canceled }),
      })
        .service.take(actor, DEAL, NOW)
        .catch((error: unknown) => error);
      expect(codeOf(taken)).toBe('ALREADY_TAKEN');
    });

    it('a pay-out another trader holds is not reassigned', async () => {
      const held = await build({
        deal: pending({
          status: TransactionStatus.Active,
          traderUserId: uuidOf(7),
        }),
      })
        .service.assignByAdmin(ADMIN, DEAL, assign, NOW)
        .catch((error: unknown) => error);

      expect(codeOf(held)).toBe('ALREADY_TAKEN');
    });
  });
});
