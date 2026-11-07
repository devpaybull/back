import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { DayPeriod } from '../../common/enums/day-period.enum';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WriteAccessGuard } from '../../common/guards/write-access.guard';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { Page } from '../../common/types/page';
import { toCrypto } from '../../common/utils/to-crypto';
import { toFiat } from '../../common/utils/to-fiat';
import { toRate } from '../../common/utils/to-rate';
import { Transaction } from '../../transactions/entities/transaction.entity';
import { PayInDeclineReason } from '../../transactions/types/pay-in-decline-reason.enum';
import { TransactionKind } from '../../transactions/types/transaction-kind.enum';
import { TransactionSortField } from '../../transactions/types/transaction-sort-field.enum';
import { TransactionStatus } from '../../transactions/types/transaction-status.enum';
import { TraderDealsController } from '../controllers/trader-deals.controller';
import { ConfirmChangedDealDto } from '../dto/confirm-changed-deal.dto';
import { DeclineDealDto } from '../dto/decline-deal.dto';
import { ListTraderDealsQueryDto } from '../dto/list-trader-deals-query.dto';
import { TraderDealFilterDto } from '../dto/trader-deal-filter.dto';
import { TraderDealSortField } from '../types/trader-deal-sort-field.enum';
import { traderDealsCsv } from '../utils/trader-deals-csv';

const TRADER = { id: uuidOf(1), impersonatedBy: uuidOf(7) } as never;
const DEAL = uuidOf(2);
const REQUISITE = uuidOf(3);
const MERCHANT = uuidOf(4);
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});
const validate = (metatype: new () => object, value: object) =>
  pipe.transform(value, { type: 'body', metatype });

const deal = {
  id: DEAL,
  kind: TransactionKind.PayIn,
  status: TransactionStatus.Active,
  method: 'sbp',
  createdAt: new Date('2026-11-07T10:00:00Z'),
  expiresAt: new Date('2026-11-07T10:15:00Z'),
  resolvedAt: null,
  amountFiat: toFiat('1000'),
  rate: toRate('100'),
  bankDetailsId: REQUISITE,
  counterpartyId: 5,
  merchantId: MERCHANT,
  traderCommission: toCrypto('0.654206'),
  traderAmount: toCrypto('9.345794'),
  traderEffectivePercent: 7,
  originalAmountFiat: null,
  declineReasonCode: null,
  declineComment: null,
} as unknown as Transaction;

const build = () => {
  const deals = {
    list: jest.fn(
      async () => new Page([deal], { total: 1, page: 1, limit: 20, pages: 1 }),
    ),
    export: jest.fn(async () => [deal]),
    statusCounts: jest.fn(async () => ({
      ...Object.fromEntries(
        Object.values(TransactionStatus).map((status) => [status, 0]),
      ),
      [TransactionStatus.Active]: 2,
      [TransactionStatus.Dispute]: 1,
      [TransactionStatus.ManualReview]: 3,
    })),
    findOwn: jest.fn(async () => deal),
  };
  const actions = {
    confirm: jest.fn(async () => deal),
    confirmChanged: jest.fn(async () => deal),
    decline: jest.fn(async () => deal),
  };
  const bankDetails = {
    findByIdsWithDeleted: jest.fn(async () => [
      {
        id: REQUISITE,
        bank: { id: 1, name: 'Т-банк' },
        mobileOperator: null,
        type: 'card_or_sbp',
        cardholderName: 'IVAN IVANOV',
        phone: '+79010000001',
        card: null,
      },
    ]),
    tagsOf: jest.fn(
      async () => new Map([[REQUISITE, [{ id: 8, name: 'основной' }]]]),
    ),
  };
  const merchants = {
    findIdsOfGroup: jest.fn(async () => [MERCHANT]),
    groupsOf: jest.fn(
      async () => new Map([[MERCHANT, { id: 6, name: 'Группа' }]]),
    ),
  };
  const counterparties = { findIdsByReference: jest.fn(async () => [5]) };
  const config = {
    getOrThrow: jest.fn((key: string) =>
      key === 'BUSINESS_TIMEZONE' ? 'Europe/Moscow' : 2,
    ),
  };
  const controller = new TraderDealsController(
    deals as never,
    actions as never,
    bankDetails as never,
    merchants as never,
    counterparties as never,
    config as never,
  );

  return { controller, deals, actions, merchants, counterparties };
};

const query = (overrides: object = {}): ListTraderDealsQueryDto =>
  Object.assign(new ListTraderDealsQueryDto(), {
    page: 1,
    limit: 20,
    sortOrder: 'desc',
    ...overrides,
  });

describe('TraderDealsController', () => {
  it('is for traders only, behind the role and write guards', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, TraderDealsController)).toEqual(
      [RolesGuard, WriteAccessGuard],
    );
    expect(
      Reflect.getMetadata(ROLES_METADATA_KEY, TraderDealsController),
    ).toEqual([Role.Trader]);
  });

  it.each(['confirm', 'confirmChanged', 'decline'] as const)(
    'marks %s as a write, so a suspended trader is refused',
    (handler) => {
      expect(
        Reflect.getMetadata(
          WRITE_ACCESS_METADATA_KEY,
          TraderDealsController.prototype[handler],
        ),
      ).toBe(true);
    },
  );

  it('reads a row: USDT profit with its fiat equivalent, the group and never the merchant', async () => {
    const { controller } = build();

    const page = await controller.list(TRADER, query());
    const [row] = page.items;

    expect(row).toEqual(
      expect.objectContaining({
        id: DEAL,
        status: TransactionStatus.Active,
        amountFiat: '1000.00',
        rate: '100.000000',
        counterpartyId: 5,
        merchantGroup: { id: 6, name: 'Группа' },
        profit: '0.654206',
        profitFiat: '65.42',
      }),
    );
    expect(row.requisite?.bank).toEqual({ id: 1, name: 'Т-банк' });
    expect(row).not.toHaveProperty('merchantId');
    expect(row).not.toHaveProperty('merchant');
  });

  it('defaults to today, ending on the last instant of the day', async () => {
    const { controller, deals } = build();

    await controller.list(TRADER, query());

    const sent = deals.list.mock.calls[0] as unknown as [
      string,
      { createdFrom: Date; createdTo: Date },
    ];
    const { createdFrom, createdTo } = sent[1];

    expect(createdTo.getTime() - createdFrom.getTime()).toBe(
      24 * 60 * 60 * 1000 - 1,
    );
    expect(createdFrom.getUTCHours()).toBe(21);
  });

  it('all_time has no start', async () => {
    const { controller, deals } = build();

    await controller.list(TRADER, query({ period: DayPeriod.AllTime }));

    const sent = deals.list.mock.calls[0] as unknown as [
      string,
      { createdFrom?: Date },
    ];
    expect(sent[1].createdFrom).toBeUndefined();
  });

  it('refuses period together with createdFrom/createdTo', async () => {
    const { controller } = build();

    await expect(
      controller.list(
        TRADER,
        query({ period: DayPeriod.Today, createdFrom: '2026-11-01' }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('turns the group, the counterparty and the requisite into filters', async () => {
    const { controller, deals, merchants, counterparties } = build();

    await controller.list(
      TRADER,
      query({
        merchantGroupId: 6,
        counterparty: 'client-1',
        bankDetailsId: REQUISITE,
        sortBy: TraderDealSortField.TraderCommission,
      }),
    );

    expect(merchants.findIdsOfGroup).toHaveBeenCalledWith(6);
    expect(counterparties.findIdsByReference).toHaveBeenCalledWith('client-1');
    expect(deals.list).toHaveBeenCalledWith(
      uuidOf(1),
      expect.objectContaining({
        merchantIds: [MERCHANT],
        counterpartyIds: [5],
        bankDetailsIds: [REQUISITE],
        sortBy: TransactionSortField.TraderCommission,
      }),
    );
  });

  it('counts the chips, an appeal being dispute and manual review', async () => {
    const { controller } = build();

    await expect(
      controller.counters(TRADER, new TraderDealFilterDto()),
    ).resolves.toEqual({
      all: 6,
      active: 2,
      dispute: 4,
      checking: 0,
      checking_manually: 0,
      success_changed: 0,
      success: 0,
      canceled: 0,
    });
  });

  it('details a deal with what the row lacks', async () => {
    const { controller } = build();

    await expect(controller.findOne(TRADER, DEAL)).resolves.toEqual(
      expect.objectContaining({
        traderAmount: '9.345794',
        traderEffectivePercent: 7,
        tags: [{ id: 8, name: 'основной' }],
        originalAmountFiat: null,
        declineReasonCode: null,
      }),
    );
  });

  it('passes the login-link superadmin along as the impersonator', async () => {
    const { controller, actions } = build();

    await controller.confirm(TRADER, DEAL);
    await controller.confirmChanged(
      TRADER,
      DEAL,
      Object.assign(new ConfirmChangedDealDto(), { amount: '500.50' }),
    );

    const actor = { traderUserId: uuidOf(1), impersonatorUserId: uuidOf(7) };

    expect(actions.confirm).toHaveBeenCalledWith(actor, DEAL);
    expect(actions.confirmChanged).toHaveBeenCalledWith(
      actor,
      DEAL,
      toFiat('500.50'),
    );
  });

  it('writes the export through the same row', async () => {
    const { controller, deals } = build();

    const file = await controller.export(TRADER, new TraderDealFilterDto());

    expect(deals.export.mock.calls[0][2 as never]).toBe(2);
    expect(file.getHeaders().type).toContain('text/csv');
  });

  describe('validation', () => {
    it('reads a status list, repeated or comma-separated', async () => {
      const dto = (await pipe.transform(
        { status: 'dispute,manual_review' },
        { type: 'query', metatype: ListTraderDealsQueryDto },
      )) as ListTraderDealsQueryDto;

      expect(dto.status).toEqual([
        TransactionStatus.Dispute,
        TransactionStatus.ManualReview,
      ]);
    });

    it.each([
      [{ search: 'abc' }],
      [{ status: 'nope' }],
      [{ sortBy: 'merchant' }],
      [{ merchantGroupId: 0 }],
      [{ bankDetailsId: 'x' }],
      [{ amountFrom: '1.001' }],
      [{ period: 'forever' }],
      [{ cascadeId: 1 }],
    ])('refuses the query %j', async (value) => {
      await expect(
        pipe.transform(value, {
          type: 'query',
          metatype: ListTraderDealsQueryDto,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it.each([
      [{}],
      [{ amount: 500 }],
      [{ amount: '0' }],
      [{ amount: '1.001' }],
    ])('refuses the changed amount %j', async (value) => {
      await expect(
        validate(ConfirmChangedDealDto, value),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it.each([
      [{}],
      [{ reasonCode: 'no_payment' }],
      [{ reasonCode: PayInDeclineReason.Other }],
      [{ reasonCode: PayInDeclineReason.Other, comment: '   ' }],
      [
        {
          reasonCode: PayInDeclineReason.LimitReached,
          comment: 'x'.repeat(501),
        },
      ],
    ])('refuses the decline %j', async (value) => {
      await expect(validate(DeclineDealDto, value)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it.each([
      [{ reasonCode: PayInDeclineReason.DeviceOffline }],
      [{ reasonCode: PayInDeclineReason.Other, comment: ' сам ' }],
    ])('accepts the decline %j', async (value) => {
      await expect(validate(DeclineDealDto, value)).resolves.toBeDefined();
    });
  });

  it('neutralises a formula in a CSV field', () => {
    const csv = traderDealsCsv([
      {
        id: DEAL,
        status: TransactionStatus.Active,
        method: 'sbp',
        currency: 'RUB',
        createdAt: new Date('2026-11-07T10:00:00Z'),
        expiresAt: null,
        resolvedAt: null,
        amountFiat: '1000.00',
        rate: '100.000000',
        requisite: null,
        counterpartyId: 5,
        merchantGroup: { id: 6, name: '=SUM(A1)' },
        profit: '1.000000',
        profitFiat: '100.00',
      },
    ]);

    expect(csv).toContain(",'=SUM(A1),");
    expect(csv.endsWith('\r\n')).toBe(true);
  });
});
