import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { toCrypto } from '../../common/utils/to-crypto';
import { toFiat } from '../../common/utils/to-fiat';
import { MerchantGroup } from '../../merchants/entities/merchant-group.entity';
import { MerchantCurrency } from '../../merchants/entities/merchant-currency.entity';
import { MerchantRateCalculation } from '../../merchants/types/merchant-rate-calculation.enum';
import { MerchantRateSource } from '../../merchants/types/merchant-rate-source.enum';
import { Merchant } from '../../merchants/entities/merchant.entity';
import { MerchantMethodState } from '../../merchants/types/merchant-method-state';
import { MerchantSortField } from '../../merchants/types/merchant-sort-field.enum';
import { MerchantTreeNode } from '../../merchants/types/merchant-tree-node';
import { MerchantMethodVolume } from '../../transactions/types/merchant-method-volume';
import { TransactionKind } from '../../transactions/types/transaction-kind.enum';
import { MerchantVolumePeriod } from '../types/merchant-volume-period.enum';
import { AuthenticatedUser } from '../../common/types/token';
import { AdminMerchantsController } from '../controllers/admin-merchants.controller';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListMerchantsQueryDto } from '../dto/list-merchants-query.dto';
import { ReplaceMerchantMarkupsDto } from '../dto/replace-merchant-markups.dto';
import { UpdateMerchantDto } from '../dto/update-merchant.dto';
import { UpdateMerchantSettingsDto } from '../dto/update-merchant-settings.dto';

const admin = { id: uuidOf(9), role: Role.Admin } as AuthenticatedUser;

const merchant = (n: number, overrides: Partial<Merchant> = {}): Merchant =>
  ({
    id: uuidOf(n),
    name: `Casino ${n}`,
    internalName: null,
    active: true,
    exclusiveTopUp: false,
    groupId: null,
    group: null,
    createdAt: new Date(n * 1000),
    ...overrides,
  }) as Merchant;

const offEverywhere = (): MerchantMethodState[] =>
  ['sbp', 'card', 'counterparty', 'mobile_commerce'].map((method) => ({
    method,
    payInEnabled: false,
    payOutEnabled: false,
  }));

const build = (
  nodes: MerchantTreeNode[],
  balances: Record<string, number>,
  volumeRows: MerchantMethodVolume[] = [],
) => {
  const merchants = {
    listTree: jest.fn(async () => nodes),
    update: jest.fn(),
    findById: jest.fn(),
    findWithGroup: jest.fn(),
  };
  const methods = {
    statesByMerchant: jest.fn(
      async (ids: string[]) =>
        new Map(
          ids.map((id) => [
            id,
            id === uuidOf(1)
              ? offEverywhere().map((state) =>
                  state.method === 'sbp'
                    ? { ...state, payInEnabled: true }
                    : state,
                )
              : offEverywhere(),
          ]),
        ),
    ),
    replace: jest.fn(),
  };
  const attachments = {
    countsByMerchant: jest.fn(
      async (ids: string[]) =>
        new Map(ids.map((id) => [id, { traders: 2, cascades: 1 }])),
    ),
  };
  const merchantBalances = {
    balancesByMerchant: jest.fn(
      async (ids: string[]) =>
        new Map(ids.map((id) => [id, toCrypto(balances[id] ?? 0)])),
    ),
    statesByMerchant: jest.fn(
      async (ids: string[]) =>
        new Map(
          ids.map((id) => [
            id,
            { balance: toCrypto(balances[id] ?? 0), escrow: toCrypto(40) },
          ]),
        ),
    ),
  };
  const settings = {
    settingsOf: jest.fn(async (merchantId: string) => ({
      merchantId,
      defaultCurrencyId: 1,
      minPayInAmount: toFiat('50000'),
      payInWindowMinutes: null,
      randomizationWindow: 20,
      sameRequestsEnabled: false,
      telegramAlertEnabled: true,
      failedDealsLimitEnabled: true,
      failedDealsPerHour: 5,
      payoutOverdraftEnabled: false,
      autoPayoutEnabled: false,
      autoPayoutAddress: null,
      autoPayoutAmount: toCrypto('10000'),
      withdrawalFee: toCrypto(0),
      withdrawalFeeWaived: false,
      rateSource: MerchantRateSource.RapiraPlus1,
      rateCalculation: MerchantRateCalculation.ByCrypto,
      callbackUrl: 'https://play2x.games/api/ipn/oh',
      successUrl: null,
      errorUrl: null,
      supportLink: null,
      ipCheckEnabled: false,
    })),
    update: jest.fn(async (merchantId: string) =>
      settings.settingsOf(merchantId),
    ),
  };
  const currencies = {
    currenciesByMerchant: jest.fn(
      async (ids: string[]) =>
        new Map(
          ids.map((id) => [
            id,
            [
              {
                merchantId: id,
                currencyId: 1,
                currency: { isocode: 'RUB', name: 'Рубль' },
                payInMarkupPercent: 1,
                payOutMarkupPercent: 0,
              } as MerchantCurrency,
            ],
          ]),
        ),
    ),
    replaceMarkups: jest.fn(async () => []),
  };
  const stats = {
    payInStats: jest.fn(async () => ({
      total: 400,
      successful: 150,
      turnover: toCrypto('65100.5'),
      turnoverCount: 150,
    })),
  };
  const rates = {
    getEffectiveMerchantGeneralRates: jest.fn(async (ids: string[]) => ({
      base: [],
      bySubject: new Map(
        ids.map((id) => [
          id,
          [{ method: 'sbp', payInPercent: 10, payOutPercent: 3 }],
        ]),
      ),
    })),
  };
  const volumes = {
    volumesByMerchant: jest.fn(async () => volumeRows),
  };
  const controller = new AdminMerchantsController(
    merchants as never,
    methods as never,
    attachments as never,
    settings as never,
    currencies as never,
    merchantBalances as never,
    volumes as never,
    stats as never,
    rates as never,
    { getOrThrow: () => 'Europe/Moscow' } as never,
  );

  return {
    controller,
    merchants,
    methods,
    attachments,
    merchantBalances,
    settings,
    currencies,
    stats,
    volumes,
    rates,
  };
};

const query = (overrides: Partial<ListMerchantsQueryDto> = {}) =>
  Object.assign(new ListMerchantsQueryDto(), overrides);

describe('AdminMerchantsController', () => {
  const group = {
    id: 1,
    name: 'Группа мерчантов',
    createdAt: new Date(0),
  } as MerchantGroup;
  const casino1 = merchant(1, { group, groupId: 1 });
  const casino2 = merchant(2, { group, groupId: 1, active: false });
  const solo = merchant(3, { name: 'Мерчант соло' });
  const nodes: MerchantTreeNode[] = [
    {
      kind: 'group',
      group,
      members: [casino1, casino2],
      shown: [casino1, casino2],
    },
    { kind: 'merchant', merchant: solo },
  ];

  it('is guarded for admin and superadmin only', () => {
    expect(
      Reflect.getMetadata(ROLES_METADATA_KEY, AdminMerchantsController),
    ).toEqual([Role.Admin, Role.Superadmin]);
  });

  it('marks every mutation as a write and the list as a read', () => {
    const { controller } = build([], {});

    for (const handler of [
      controller.update,
      controller.replaceMethods,
      controller.replaceMarkups,
      controller.updateSettings,
    ]) {
      expect(Reflect.getMetadata(WRITE_ACCESS_METADATA_KEY, handler)).toBe(
        true,
      );
    }
    expect(
      Reflect.getMetadata(WRITE_ACCESS_METADATA_KEY, controller.list),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(WRITE_ACCESS_METADATA_KEY, controller.card),
    ).toBeUndefined();
  });

  it('no longer creates a merchant: that is the invite of a merchant role', () => {
    const { controller } = build([], {});

    expect(
      (controller as unknown as Record<string, unknown>).create,
    ).toBeUndefined();
  });

  it('answers a group row with its merchants and a merchant row, summed and aggregated', async () => {
    const { controller } = build(nodes, {
      [uuidOf(1)]: 50000.5,
      [uuidOf(2)]: 0.5,
      [uuidOf(3)]: 7,
    });

    const page = await controller.list(query({ sortOrder: SortOrder.Asc }));

    expect(page.meta).toEqual({ total: 2, page: 1, limit: 20, pages: 1 });
    const [groupRow, soloRow] = page.items;
    expect(groupRow.kind).toBe('group');
    expect(groupRow.merchant).toBeNull();
    expect(groupRow.group).toEqual(
      expect.objectContaining({
        id: 1,
        name: 'Группа мерчантов',
        active: true,
        exclusiveTopUp: false,
        balance: '50001.000000',
      }),
    );
    expect(groupRow.group?.methods.payIn[0]).toEqual({
      method: 'sbp',
      enabled: true,
      percent: null,
      volume: '0.00',
    });
    expect(groupRow.group?.merchants.map((row) => row.id)).toEqual([
      uuidOf(1),
      uuidOf(2),
    ]);
    expect(soloRow).toEqual({
      kind: 'merchant',
      group: null,
      merchant: expect.objectContaining({
        id: uuidOf(3),
        balance: '7.000000',
        attachments: { traders: 2, cascades: 1 },
      }),
    });
    expect(soloRow.merchant?.methods.payIn[0]).toEqual({
      method: 'sbp',
      enabled: false,
      percent: 10,
      volume: '0.00',
    });
    expect(soloRow.merchant?.methods.payOut[0]).toEqual({
      method: 'sbp',
      enabled: false,
      percent: 3,
      volume: '0.00',
    });
  });

  it('shows the volume per method and direction, a group summing its merchants', async () => {
    const { controller } = build(nodes, {}, [
      {
        merchantId: uuidOf(1),
        method: 'sbp',
        kind: TransactionKind.PayIn,
        volume: toFiat('1000.10'),
      },
      {
        merchantId: uuidOf(2),
        method: 'sbp',
        kind: TransactionKind.PayIn,
        volume: toFiat('0.20'),
      },
      {
        merchantId: uuidOf(3),
        method: 'card',
        kind: TransactionKind.PayOut,
        volume: toFiat(500),
      },
    ]);

    const [groupRow, soloRow] = (
      await controller.list(query({ sortOrder: SortOrder.Asc }))
    ).items;

    expect(groupRow.group?.methods.payIn[0].volume).toBe('1000.30');
    expect(groupRow.group?.merchants[0].methods.payIn[0].volume).toBe(
      '1000.10',
    );
    expect(groupRow.group?.methods.payOut[0].volume).toBe('0.00');
    expect(
      soloRow.merchant?.methods.payOut.find((chip) => chip.method === 'card')
        ?.volume,
    ).toBe('500.00');
  });

  it('offers pay-out chips for sbp and card only', async () => {
    const { controller } = build(nodes, {});

    const [, soloRow] = (
      await controller.list(query({ sortOrder: SortOrder.Asc }))
    ).items;

    expect(soloRow.merchant?.methods.payIn.map((chip) => chip.method)).toEqual([
      'sbp',
      'card',
      'counterparty',
      'mobile_commerce',
    ]);
    expect(soloRow.merchant?.methods.payOut.map((chip) => chip.method)).toEqual(
      ['sbp', 'card'],
    );
  });

  describe('the volume period, in calendar days of the business timezone', () => {
    beforeEach(() => {
      jest
        .useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] })
        .setSystemTime(new Date('2026-10-26T22:30:00.000Z'));
    });

    afterEach(() => jest.useRealTimers());

    const periodOf = async (overrides: Partial<ListMerchantsQueryDto>) => {
      const { controller, volumes } = build(nodes, {});

      await controller.list(query(overrides));

      const [, from, to] = volumes.volumesByMerchant.mock
        .calls[0] as unknown as [string[], Date, Date];

      return [from.toISOString(), to.toISOString()];
    };

    it.each([
      [
        'today by default',
        {},
        ['2026-10-26T21:00:00.000Z', '2026-10-27T21:00:00.000Z'],
      ],
      [
        'yesterday',
        { period: MerchantVolumePeriod.Yesterday },
        ['2026-10-25T21:00:00.000Z', '2026-10-26T21:00:00.000Z'],
      ],
      [
        'today and the six days before',
        { period: MerchantVolumePeriod.Last7Days },
        ['2026-10-20T21:00:00.000Z', '2026-10-27T21:00:00.000Z'],
      ],
      [
        'from the 1st of this month',
        { period: MerchantVolumePeriod.Month },
        ['2026-09-30T21:00:00.000Z', '2026-10-27T21:00:00.000Z'],
      ],
      [
        'a custom range, both days included',
        { periodFrom: '2026-10-01', periodTo: '2026-10-03' },
        ['2026-09-30T21:00:00.000Z', '2026-10-03T21:00:00.000Z'],
      ],
    ])('reads %s', async (_label, overrides, expected) => {
      expect(await periodOf(overrides)).toEqual(expected);
    });

    it.each([
      [
        {
          period: MerchantVolumePeriod.Today,
          periodFrom: '2026-10-01',
          periodTo: '2026-10-02',
        },
      ],
      [{ periodFrom: '2026-10-01' }],
      [{ periodTo: '2026-10-01' }],
    ])('refuses %p with a 400 before reading anything', async (overrides) => {
      const { controller, merchants } = build(nodes, {});

      await expect(controller.list(query(overrides))).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(merchants.listTree).not.toHaveBeenCalled();
    });
  });

  it('shows the group as off only when every merchant of it is off', async () => {
    const off = [
      merchant(1, { group, groupId: 1, active: false }),
      merchant(2, { group, groupId: 1, active: false }),
    ];
    const { controller } = build(
      [{ kind: 'group', group, members: off, shown: off }],
      {},
    );

    const page = await controller.list(query());

    expect(page.items[0].group?.active).toBe(false);
  });

  it('sorts by balance, a group by the sum of its merchants', async () => {
    const { controller } = build(nodes, {
      [uuidOf(1)]: 5,
      [uuidOf(2)]: 5,
      [uuidOf(3)]: 7,
    });

    const page = await controller.list(
      query({ sortBy: MerchantSortField.Balance, sortOrder: SortOrder.Desc }),
    );

    expect(page.items.map((row) => row.kind)).toEqual(['group', 'merchant']);
    expect(page.items[0].group?.merchants.map((row) => row.id)).toEqual([
      uuidOf(2),
      uuidOf(1),
    ]);
  });

  it('pages over top-level rows, never splitting a group', async () => {
    const { controller } = build(nodes, {});

    const page = await controller.list(
      query({ limit: 1, page: 2, sortOrder: SortOrder.Asc }),
    );

    expect(page.meta).toEqual({ total: 2, page: 2, limit: 1, pages: 2 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].kind).toBe('merchant');
  });

  it('reads the details of the whole page in one call each', async () => {
    const { controller, methods, attachments, merchantBalances, rates } = build(
      nodes,
      {},
    );

    await controller.list(query());

    const ids = [uuidOf(1), uuidOf(2), uuidOf(3)];
    expect(merchantBalances.balancesByMerchant).toHaveBeenCalledWith(ids);
    expect(methods.statesByMerchant).toHaveBeenCalledWith(ids);
    expect(attachments.countsByMerchant).toHaveBeenCalledWith(ids);
    expect(rates.getEffectiveMerchantGeneralRates).toHaveBeenCalledTimes(1);
  });

  it('answers an empty page without asking for rates', async () => {
    const { controller, rates } = build([], {});

    const page = await controller.list(query());

    expect(page.items).toEqual([]);
    expect(rates.getEffectiveMerchantGeneralRates).not.toHaveBeenCalled();
  });

  it('refuses an empty edit with a 400', async () => {
    const { controller, merchants } = build([], {});

    await expect(
      controller.update(uuidOf(1), {}, admin),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(merchants.update).not.toHaveBeenCalled();
  });

  it('clears the internal name for an empty string and answers the row', async () => {
    const { controller, merchants } = build([], {});
    merchants.update.mockResolvedValue(merchant(1, { name: 'Renamed' }));

    const row = await controller.update(
      uuidOf(1),
      { name: 'Renamed', internalName: '' },
      admin,
    );

    expect(merchants.update).toHaveBeenCalledWith(
      uuidOf(1),
      { name: 'Renamed', internalName: null },
      admin.id,
    );
    expect(row.name).toBe('Renamed');
  });

  it('replaces the switched-on methods as the admin', async () => {
    const { controller, methods } = build([], {});

    await controller.replaceMethods(
      uuidOf(1),
      {
        methods: [{ method: 'sbp', payInEnabled: true, payOutEnabled: false }],
      },
      admin,
    );

    expect(methods.replace).toHaveBeenCalledWith(
      uuidOf(1),
      [{ method: 'sbp', payInEnabled: true, payOutEnabled: false }],
      admin.id,
    );
  });

  describe('UpdateMerchantDto', () => {
    const errors = async (body: object) =>
      (await validate(plainToInstance(UpdateMerchantDto, body))).map(
        (error) => error.property,
      );

    it('lets the internal name and the group be cleared with null', async () => {
      expect(await errors({ internalName: null, groupId: null })).toEqual([]);
    });

    it('refuses null where a value cannot be cleared, and a blank name', async () => {
      expect(await errors({ active: null })).toEqual(['active']);
      expect(await errors({ exclusiveTopUp: null })).toEqual([
        'exclusiveTopUp',
      ]);
      expect(await errors({ name: '   ' })).toEqual(['name']);
      expect(await errors({ internalName: 'x'.repeat(101) })).toEqual([
        'internalName',
      ]);
      expect(await errors({ groupId: 0 })).toEqual(['groupId']);
    });
  });

  describe('ListMerchantsQueryDto', () => {
    const errors = async (query: object) =>
      (await validate(plainToInstance(ListMerchantsQueryDto, query))).map(
        (error) => error.property,
      );

    it('reads ?exclusiveTopUp=false as a filter and refuses unknown values', async () => {
      expect(
        plainToInstance(ListMerchantsQueryDto, { exclusiveTopUp: 'false' })
          .exclusiveTopUp,
      ).toBe(false);
      expect(await errors({ status: 'paused' })).toEqual(['status']);
      expect(await errors({ sortBy: 'period' })).toEqual(['sortBy']);
      expect(await errors({ sortBy: 'balance', status: 'active' })).toEqual([]);
    });

    it('takes a known period and two calendar days in order', async () => {
      expect(await errors({ period: 'last_7_days' })).toEqual([]);
      expect(await errors({ period: 'week' })).toEqual(['period']);
      expect(
        await errors({ periodFrom: '2026-10-01', periodTo: '2026-10-01' }),
      ).toEqual([]);
      expect(
        await errors({ periodFrom: '2026-10-02', periodTo: '2026-10-01' }),
      ).toEqual(['periodTo']);
      expect(
        await errors({
          periodFrom: '2026-10-01T00:00:00Z',
          periodTo: '2026-02-30',
        }),
      ).toEqual(['periodFrom', 'periodTo']);
    });
  });
});

describe('AdminMerchantsController, the merchant page', () => {
  const superadmin = {
    id: uuidOf(8),
    role: Role.Superadmin,
  } as AuthenticatedUser;
  const group = { id: 4, name: 'A7', createdAt: new Date(0) } as MerchantGroup;

  afterEach(() => {
    jest.useRealTimers();
  });

  it('answers 404 for the card of an unknown merchant', async () => {
    const { controller, merchants } = build([], {});
    merchants.findWithGroup.mockResolvedValue(null);

    await expect(controller.card(uuidOf(1))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('reads the card: row fields, group, escrow, currencies, settings and the 7-day pay-in KPIs in Moscow days', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-26T12:00:00Z') });
    const { controller, merchants, stats } = build([], { [uuidOf(1)]: 100 });
    const updatedAt = new Date('2026-10-25T10:00:00Z');
    merchants.findWithGroup.mockResolvedValue(
      merchant(1, { group, groupId: 4, updatedAt }),
    );

    const card = await controller.card(uuidOf(1));

    const from = new Date('2026-10-19T21:00:00Z');
    const to = new Date('2026-10-26T21:00:00Z');
    expect(stats.payInStats).toHaveBeenCalledWith(uuidOf(1), from, to);
    expect(card).toEqual(
      expect.objectContaining({
        id: uuidOf(1),
        balance: '100.000000',
        escrow: '40.000000',
        group: { id: 4, name: 'A7' },
        updatedAt,
        currencies: [
          {
            currencyId: 1,
            isocode: 'RUB',
            name: 'Рубль',
            payInMarkupPercent: 1,
            payOutMarkupPercent: 0,
          },
        ],
        kpi: {
          from,
          to,
          conversion: { successful: 150, total: 400, percent: 37.5 },
          turnover: { amount: '65100.500000', count: 150 },
        },
      }),
    );
    expect(card.settings).toEqual(
      expect.objectContaining({
        defaultCurrencyId: 1,
        minPayInAmount: '50000.00',
        autoPayoutAmount: '10000.000000',
        withdrawalFee: '0.000000',
        rateSource: 'rapira_plus_1',
      }),
    );
  });

  it('answers a zero conversion when nothing was created in the window', async () => {
    const { controller, merchants, stats } = build([], {});
    merchants.findWithGroup.mockResolvedValue(merchant(1));
    stats.payInStats.mockResolvedValueOnce({
      total: 0,
      successful: 0,
      turnover: toCrypto(0),
      turnoverCount: 0,
    });

    const card = await controller.card(uuidOf(1));

    expect(card.group).toBeNull();
    expect(card.kpi.conversion.percent).toBe(0);
  });

  it('takes currencies alone as a change', async () => {
    const { controller, merchants } = build([], {});
    merchants.update.mockResolvedValue(merchant(1));

    await controller.update(
      uuidOf(1),
      { currencyIds: [1, 2], defaultCurrencyId: 1 },
      admin,
    );

    expect(merchants.update).toHaveBeenCalledWith(
      uuidOf(1),
      { currencyIds: [1, 2], defaultCurrencyId: 1 },
      admin.id,
    );
  });

  it('hands the markups to the currencies service', async () => {
    const { controller, currencies } = build([], {});
    const markups = [{ currencyId: 1, payInPercent: 1, payOutPercent: 0 }];

    await controller.replaceMarkups(uuidOf(1), { markups }, admin);

    expect(currencies.replaceMarkups).toHaveBeenCalledWith(
      uuidOf(1),
      markups,
      admin.id,
    );
  });

  it.each([
    'payoutOverdraftEnabled',
    'autoPayoutEnabled',
    'autoPayoutAddress',
    'autoPayoutAmount',
    'ipCheckEnabled',
  ])('refuses %s from an admin with a 403', async (key) => {
    const { controller, settings } = build([], {});
    const value =
      key === 'autoPayoutAddress' || key === 'autoPayoutAmount' ? null : true;

    await expect(
      controller.updateSettings(
        uuidOf(1),
        { [key]: value } as UpdateMerchantSettingsDto,
        admin,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(settings.update).not.toHaveBeenCalled();
  });

  it('lets a superadmin change them, with the amounts typed', async () => {
    const { controller, settings } = build([], {});

    await controller.updateSettings(
      uuidOf(1),
      {
        payoutOverdraftEnabled: true,
        autoPayoutAddress: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE',
        autoPayoutAmount: '10000',
        minPayInAmount: null,
        withdrawalFee: '1.5',
      },
      superadmin,
    );

    expect(settings.update).toHaveBeenCalledWith(
      uuidOf(1),
      {
        payoutOverdraftEnabled: true,
        autoPayoutAddress: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE',
        autoPayoutAmount: toCrypto('10000'),
        minPayInAmount: null,
        withdrawalFee: toCrypto('1.5'),
      },
      superadmin.id,
    );
  });

  it('lets an admin change the rest', async () => {
    const { controller, settings } = build([], {});

    await controller.updateSettings(
      uuidOf(1),
      { minPayInAmount: '50000', randomizationWindow: 20 },
      admin,
    );

    expect(settings.update).toHaveBeenCalledWith(
      uuidOf(1),
      expect.objectContaining({
        minPayInAmount: toFiat('50000'),
        randomizationWindow: 20,
        autoPayoutAmount: undefined,
        withdrawalFee: undefined,
      }),
      admin.id,
    );
  });

  it('refuses an auto payout address that is not TRC-20 with a 400', async () => {
    const { controller, settings } = build([], {});

    await expect(
      controller.updateSettings(
        uuidOf(1),
        { autoPayoutAddress: 'TNotAnAddress' },
        superadmin,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(settings.update).not.toHaveBeenCalled();
  });

  describe('the DTOs', () => {
    const errorsOf = async (type: new () => object, body: object) =>
      (await validate(plainToInstance(type, body))).map(
        (error) => error.property,
      );

    it('takes a non-empty set of distinct currencies and a default', async () => {
      expect(
        await errorsOf(UpdateMerchantDto, {
          currencyIds: [1, 2],
          defaultCurrencyId: 1,
        }),
      ).toEqual([]);
      expect(await errorsOf(UpdateMerchantDto, { currencyIds: [] })).toEqual([
        'currencyIds',
      ]);
      expect(
        await errorsOf(UpdateMerchantDto, { currencyIds: [1, 1] }),
      ).toEqual(['currencyIds']);
      expect(
        await errorsOf(UpdateMerchantDto, { defaultCurrencyId: null }),
      ).toEqual(['defaultCurrencyId']);
    });

    it('bounds a markup to ±99.999 with three decimals', async () => {
      const markup = (payInPercent: unknown) => ({
        markups: [{ currencyId: 1, payInPercent, payOutPercent: 0 }],
      });

      expect(
        await errorsOf(ReplaceMerchantMarkupsDto, markup(-99.999)),
      ).toEqual([]);
      expect(await errorsOf(ReplaceMerchantMarkupsDto, markup(100))).toEqual([
        'markups',
      ]);
      expect(await errorsOf(ReplaceMerchantMarkupsDto, markup(1.2345))).toEqual(
        ['markups'],
      );
    });

    it('validates the settings: money as strings, bounds, https links, null to clear', async () => {
      expect(
        await errorsOf(UpdateMerchantSettingsDto, {
          minPayInAmount: null,
          payInWindowMinutes: null,
          callbackUrl: null,
          randomizationWindow: 0,
          failedDealsPerHour: 1000,
          withdrawalFee: '0',
          successUrl: 'https://play2x.ml/',
        }),
      ).toEqual([]);
      expect(
        await errorsOf(UpdateMerchantSettingsDto, { minPayInAmount: 50000 }),
      ).toEqual(['minPayInAmount']);
      expect(
        await errorsOf(UpdateMerchantSettingsDto, { randomizationWindow: 51 }),
      ).toEqual(['randomizationWindow']);
      expect(
        await errorsOf(UpdateMerchantSettingsDto, { payInWindowMinutes: 121 }),
      ).toEqual(['payInWindowMinutes']);
      expect(
        await errorsOf(UpdateMerchantSettingsDto, {
          callbackUrl: 'http://play2x.ml/',
        }),
      ).toEqual(['callbackUrl']);
      expect(
        await errorsOf(UpdateMerchantSettingsDto, {
          sameRequestsEnabled: null,
        }),
      ).toEqual(['sameRequestsEnabled']);
      expect(
        await errorsOf(UpdateMerchantSettingsDto, { rateSource: 'binance' }),
      ).toEqual(['rateSource']);
    });
  });
});
