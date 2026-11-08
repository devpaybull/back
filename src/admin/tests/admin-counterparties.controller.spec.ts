import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { BankDetailsType } from '../../bank-details/types/bank-details-type.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { Page } from '../../common/types/page';
import { toFiat } from '../../common/utils/to-fiat';
import { Counterparty } from '../../counterparties/entities/counterparty.entity';
import { CounterpartyBindingType } from '../../counterparties/types/counterparty-binding-type.enum';
import { CounterpartyHealth } from '../../counterparties/types/counterparty-health.enum';
import { CounterpartySortField } from '../../counterparties/types/counterparty-sort-field.enum';
import { AdminCounterpartiesController } from '../controllers/admin-counterparties.controller';
import { AdminCounterpartyRequisitesController } from '../controllers/admin-counterparty-requisites.controller';
import { ListCounterpartiesQueryDto } from '../dto/list-counterparties-query.dto';

const MERCHANT = uuidOf(50);
const TRADER = uuidOf(60);
const REQUISITE = uuidOf(70);
const ADMIN = { id: uuidOf(1) } as never;

const counterparty = (overrides: Partial<Counterparty> = {}): Counterparty =>
  ({
    id: 1,
    merchantId: MERCHANT,
    externalId: '1234451241',
    name: null,
    contact: null,
    enabled: true,
    blacklistedAt: null,
    autoEnableForbidden: false,
    bankDetailsId: null,
    bindingType: null,
    boundAt: null,
    dealCount: 0,
    completedCount: 0,
    paidCount: 0,
    disputeCount: 0,
    paidAmount: toFiat(0),
    requestCount: 0,
    lastRequestAt: null,
    lastDepositAt: null,
    createdAt: new Date('2026-06-24T08:32:00Z'),
    ...overrides,
  }) as Counterparty;

const requisite = {
  id: REQUISITE,
  type: BankDetailsType.CardOrSbp,
  card: null,
  phone: '+79012345678',
  cardholderName: 'Шевченко Д.',
  bank: { id: 3, name: 'Т-банк' },
  user: {
    id: TRADER,
    telegramUsername: 'super_maks',
    email: 'super_maks@mail.ru',
  },
  userId: TRADER,
  active: true,
  bannedAt: null,
};

const query = (
  overrides: Partial<ListCounterpartiesQueryDto> = {},
): ListCounterpartiesQueryDto =>
  ({
    page: 1,
    limit: 20,
    sortOrder: SortOrder.Desc,
    sortBy: CounterpartySortField.CreatedAt,
    ...overrides,
  }) as ListCounterpartiesQueryDto;

const build = () => {
  const counterparties = {
    list: jest.fn(),
    countByStatus: jest.fn<
      Promise<{ all: number; enabled: number; disabled: number }>,
      [{ blacklisted?: boolean }, Date]
    >(async () => ({ all: 3, enabled: 2, disabled: 1 })),
    findById: jest.fn(async (): Promise<Counterparty | null> => counterparty()),
    windowVolumesOf: jest.fn(async () => new Map()),
    update: jest.fn(async () => counterparty({ enabled: false })),
    unbind: jest.fn(async () => counterparty()),
    listRequisiteEvents: jest.fn(),
  };
  const dealStats = { statsOf: jest.fn(), listDealEvents: jest.fn() };
  const bankDetails = {
    findIdsOfUsers: jest.fn(async (): Promise<string[]> => []),
    findIdsMatching: jest.fn(async (): Promise<string[]> => []),
    findByIdsInOrder: jest.fn(async () => [requisite]),
    findByIdsWithDeleted: jest.fn(async () => [requisite]),
    bindToCounterparty: jest.fn(async () =>
      counterparty({
        bankDetailsId: REQUISITE,
        bindingType: CounterpartyBindingType.CardsOrSbp,
        boundAt: new Date(),
      }),
    ),
    replaceCounterpartyRequisite: jest.fn(async () => counterparty()),
    listCounterpartyOnly: jest.fn(),
  };
  const merchants = {
    findByIds: jest.fn(async () => [{ id: MERCHANT, name: 'Мерчант A7' }]),
    findIdsMatching: jest.fn(async (): Promise<string[]> => []),
  };
  const directory = {
    findByIds: jest.fn(async () => [requisite.user]),
    findIdsMatching: jest.fn(async (): Promise<string[]> => []),
  };
  const requestLog = {
    countForCounterparty: jest.fn(async () => 7),
    listForCounterparty: jest.fn(async (): Promise<[unknown[], number]> => [
      [],
      0,
    ]),
  };
  const controller = new AdminCounterpartiesController(
    counterparties as never,
    dealStats as never,
    bankDetails as never,
    merchants as never,
    directory as never,
    requestLog as never,
  );

  return {
    controller,
    counterparties,
    dealStats,
    requestLog,
    bankDetails,
    merchants,
    directory,
  };
};

describe('AdminCounterpartiesController', () => {
  it('is guarded for admin and superadmin only', () => {
    for (const target of [
      AdminCounterpartiesController,
      AdminCounterpartyRequisitesController,
    ]) {
      expect(Reflect.getMetadata(ROLES_METADATA_KEY, target)).toEqual([
        Role.Admin,
        Role.Superadmin,
      ]);
    }
  });

  it('marks every mutation, and no read, as a write', () => {
    const { prototype } = AdminCounterpartiesController;
    const marked = (name: keyof AdminCounterpartiesController) =>
      Reflect.getMetadata(WRITE_ACCESS_METADATA_KEY, prototype[name]);

    for (const write of ['update', 'bind', 'replace', 'unbind'] as const) {
      expect(marked(write)).toBe(true);
    }
    for (const read of [
      'list',
      'counts',
      'findOne',
      'stats',
      'dealEvents',
      'requisiteEvents',
    ] as const) {
      expect(marked(read)).toBeUndefined();
    }
  });

  it('composes a list row with the merchant, the binding and the figures', async () => {
    const { controller, counterparties } = build();
    counterparties.list.mockResolvedValue(
      new Page(
        [
          counterparty({
            bankDetailsId: REQUISITE,
            bindingType: CounterpartyBindingType.CardsOrSbp,
            boundAt: new Date('2026-05-15T00:00:00Z'),
            dealCount: 590,
            completedCount: 586,
            paidCount: 580,
            disputeCount: 21,
            paidAmount: toFiat('1160000.00'),
            requestCount: 600,
            lastRequestAt: new Date('2026-11-05T10:00:00Z'),
          }),
        ],
        { total: 1, page: 1, limit: 20, pages: 1 },
      ),
    );
    counterparties.windowVolumesOf.mockResolvedValue(
      new Map([
        [1, { volume7d: toFiat('2000000'), volume30d: toFiat('40000000') }],
      ]),
    );

    const page = await controller.list(query());
    const [row] = page.items;

    expect(row.merchant).toEqual({ id: MERCHANT, name: 'Мерчант A7' });
    expect(row.binding.requisite.trader).toEqual({
      id: TRADER,
      login: 'super_maks',
      email: 'super_maks@mail.ru',
    });
    expect(row.binding.bindingType).toBe(CounterpartyBindingType.CardsOrSbp);
    expect(row.conversion).toBe(98.98);
    expect(row.averageCheck).toBe('2000.00');
    expect(row.disputes).toBe(21);
    expect(row.volume7d).toBe('2000000.00');
    expect(row.volume30d).toBe('40000000.00');
    expect(row.volumeTotal).toBe('1160000.00');
    expect(row.requestCount).toBe(600);
    expect(row.lastLoginAt).toEqual(new Date('2026-11-05T10:00:00Z'));
    expect(row.currency).toBe('RUB');
    expect(page.meta.total).toBe(1);
  });

  it('answers null conversion and average check with nothing completed or paid', async () => {
    const { controller } = build();

    const card = await controller.findOne(1);

    expect(card.conversion).toBeNull();
    expect(card.averageCheck).toBeNull();
    expect(card.binding).toBeNull();
    expect(card.health).toBe(CounterpartyHealth.Active);
  });

  it('shows a blacklisted counterparty as blacklisted', async () => {
    const { controller, counterparties } = build();
    counterparties.findById.mockResolvedValue(
      counterparty({ enabled: false, blacklistedAt: new Date() }),
    );

    const card = await controller.findOne(1);

    expect(card.blacklisted).toBe(true);
    expect(card.health).toBe(CounterpartyHealth.Blacklisted);
  });

  it('narrows to the trader’s requisites, intersected with an asked-for requisite', async () => {
    const { controller, counterparties, bankDetails } = build();
    counterparties.list.mockResolvedValue(
      new Page([], { total: 0, page: 1, limit: 20, pages: 0 }),
    );
    bankDetails.findIdsOfUsers.mockResolvedValue([uuidOf(71), REQUISITE]);

    await controller.list(
      query({ traderUserId: TRADER, bankDetailsId: REQUISITE }),
    );

    expect(bankDetails.findIdsOfUsers).toHaveBeenCalledWith([TRADER]);
    expect(counterparties.list.mock.calls[0][0].bankDetailsIds).toEqual([
      REQUISITE,
    ]);
  });

  it('passes the volume ranges as fiat and leaves absent windows out', async () => {
    const { controller, counterparties } = build();
    counterparties.list.mockResolvedValue(
      new Page([], { total: 0, page: 1, limit: 20, pages: 0 }),
    );

    await controller.list(
      query({
        volume30dFrom: '1000.00',
        volumeTotalTo: '5000.50',
        paid30dTo: 3,
      }),
    );

    const filter = counterparties.list.mock.calls[0][0];
    expect([...filter.windowVolumes.keys()]).toEqual([30]);
    expect(filter.windowVolumes.get(30).from.toFixed(2)).toBe('1000.00');
    expect(filter.windowVolumes.get(30).to).toBeUndefined();
    expect(filter.totalVolume.to.toFixed(2)).toBe('5000.50');
    expect(filter.paid30d).toEqual({ from: undefined, to: 3 });
  });

  it('searches the merchant, the trader’s requisites and the requisites themselves', async () => {
    const { controller, counterparties, bankDetails, merchants, directory } =
      build();
    counterparties.list.mockResolvedValue(
      new Page([], { total: 0, page: 1, limit: 20, pages: 0 }),
    );
    merchants.findIdsMatching.mockResolvedValue([MERCHANT]);
    directory.findIdsMatching.mockResolvedValue([TRADER]);
    bankDetails.findIdsMatching.mockResolvedValue([uuidOf(72)]);
    bankDetails.findIdsOfUsers.mockResolvedValue([REQUISITE, uuidOf(72)]);

    await controller.list(query({ search: 'maks' }));

    const filter = counterparties.list.mock.calls[0][0];
    expect(filter.search).toBe('maks');
    expect(filter.searchMerchantIds).toEqual([MERCHANT]);
    expect(filter.searchBankDetailsIds).toEqual([uuidOf(72), REQUISITE]);
    expect(filter.bankDetailsIds).toBeUndefined();
  });

  it('counts the tabs under the same filters', async () => {
    const { controller, counterparties } = build();

    await expect(
      controller.counts(query({ blacklisted: true })),
    ).resolves.toEqual({ all: 3, enabled: 2, disabled: 1 });
    expect(counterparties.countByStatus.mock.calls[0][0].blacklisted).toBe(
      true,
    );
  });

  it('404 for an unknown counterparty, 400 for an id beyond int4', async () => {
    const { controller, counterparties } = build();
    counterparties.findById.mockResolvedValue(null);

    await expect(controller.findOne(1)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(controller.findOne(2147483648)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(controller.stats(1, {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('shapes the statistics of a method', async () => {
    const { controller, dealStats, requestLog } = build();
    dealStats.statsOf.mockResolvedValue({
      dealCount: 600,
      completedCount: 504,
      paidCount: 500,
      disputeCount: 2,
      paidAmount: toFiat('122750250.00'),
      lastDepositAt: null,
      volume7d: toFiat('200000.50'),
      volume30d: toFiat('1000000.50'),
    });

    const stats = await controller.stats(1, { method: 'sbp' });

    expect(dealStats.statsOf).toHaveBeenCalledWith(1, 'sbp', expect.any(Date));
    expect(stats).toMatchObject({
      method: 'sbp',
      conversion: 99.21,
      averageCheck: '245500.50',
      funnel: { requests: 7, deals: 600, paid: 500 },
      volume7d: '200000.50',
      volumeTotal: '122750250.00',
    });
    expect(requestLog.countForCounterparty).toHaveBeenCalledWith(1, 'sbp');
  });

  it('takes the funnel’s requests from the counter without a method', async () => {
    const { controller, dealStats, counterparties, requestLog } = build();
    dealStats.statsOf.mockResolvedValue({
      dealCount: 1,
      completedCount: 0,
      paidCount: 0,
      disputeCount: 0,
      paidAmount: toFiat(0),
      lastDepositAt: null,
      volume7d: toFiat(0),
      volume30d: toFiat(0),
    });
    counterparties.findById.mockResolvedValue(
      counterparty({ requestCount: 42 }),
    );

    const stats = await controller.stats(1, {});

    expect(stats.funnel.requests).toBe(42);
    expect(requestLog.countForCounterparty).not.toHaveBeenCalled();
  });

  it('passes the «Запросов 30 д.» range as counts', async () => {
    const { controller, counterparties } = build();
    counterparties.list.mockResolvedValue(
      new Page([], { total: 0, page: 1, limit: 20, pages: 0 }),
    );

    await controller.list(query({ requests30dFrom: 2, requests30dTo: 9 }));

    expect(counterparties.list.mock.calls[0][0]).toMatchObject({
      requests30d: { from: 2, to: 9 },
    });
  });

  it('takes the actor of every write from the token', async () => {
    const { controller, counterparties, bankDetails } = build();

    await controller.update(1, { blacklisted: true, reason: 'fraud' }, ADMIN);
    await controller.bind(
      1,
      { bankDetailsId: REQUISITE, bindingType: CounterpartyBindingType.Sbp },
      ADMIN,
    );
    await controller.replace(1, { bankDetailsId: REQUISITE }, ADMIN);
    await controller.unbind(1, ADMIN);

    expect(counterparties.update).toHaveBeenCalledWith(
      1,
      { blacklisted: true, reason: 'fraud' },
      uuidOf(1),
    );
    expect(bankDetails.bindToCounterparty).toHaveBeenCalledWith(
      REQUISITE,
      1,
      CounterpartyBindingType.Sbp,
      uuidOf(1),
    );
    expect(bankDetails.replaceCounterpartyRequisite).toHaveBeenCalledWith(
      REQUISITE,
      1,
      uuidOf(1),
    );
    expect(counterparties.unbind).toHaveBeenCalledWith(1, uuidOf(1));
  });

  it('enriches deal events with the trader and the requisite', async () => {
    const { controller, dealStats } = build();
    dealStats.listDealEvents.mockResolvedValue(
      new Page(
        [
          {
            id: 9,
            createdAt: new Date(),
            fromStatus: null,
            toStatus: 'active',
            source: 'system',
            transaction: {
              id: uuidOf(90),
              kind: 'pay_in',
              method: 'sbp',
              status: 'success',
              amountFiat: toFiat('200000'),
              traderUserId: TRADER,
              bankDetailsId: REQUISITE,
            },
          },
        ],
        { total: 1, page: 1, limit: 20, pages: 1 },
      ),
    );

    const page = await controller.dealEvents(1, {
      page: 1,
      limit: 20,
      sortOrder: SortOrder.Desc,
    } as never);

    expect(page.items[0]).toMatchObject({
      fromStatus: null,
      deal: { id: uuidOf(90), amountFiat: '200000.00' },
      trader: { login: 'super_maks' },
      requisite: { id: REQUISITE, phone: '+79012345678' },
    });
  });

  it('merges the creation requests into the deal events by time, the request with its trader and outcome', async () => {
    const { controller, dealStats, requestLog } = build();
    const statusEvent = (id: number, at: string) => ({
      id,
      createdAt: new Date(at),
      fromStatus: null,
      toStatus: 'active',
      source: 'system',
      transaction: {
        id: uuidOf(90),
        kind: 'pay_in',
        method: 'sbp',
        status: 'active',
        amountFiat: toFiat('2000'),
        traderUserId: TRADER,
        bankDetailsId: REQUISITE,
      },
    });
    dealStats.listDealEvents.mockResolvedValue(
      new Page(
        [
          statusEvent(9, '2026-11-05T10:00:03Z'),
          statusEvent(8, '2026-11-05T09:00:00Z'),
        ],
        { total: 2, page: 1, limit: 4, pages: 1 },
      ),
    );
    requestLog.listForCounterparty.mockResolvedValue([
      [
        {
          id: uuidOf(500),
          receivedAt: new Date('2026-11-05T10:00:02Z'),
          paymentMethod: 'sbp',
          amountFiat: toFiat('2000'),
          currency: 'RUB',
          result: 'created',
          statusCode: 201,
          errorCode: null,
          transactionId: uuidOf(90),
          processedByUserId: TRADER,
        },
        {
          id: uuidOf(501),
          receivedAt: new Date('2026-11-05T09:30:00Z'),
          paymentMethod: 'sbp',
          amountFiat: toFiat('3000'),
          currency: 'RUB',
          result: 'not_created',
          statusCode: 403,
          errorCode: 'NO_REQUISITE_FOUND_FOR_THIS_AMOUNT',
          transactionId: null,
          processedByUserId: null,
        },
      ],
      2,
    ]);

    const page = await controller.dealEvents(1, {
      page: 1,
      limit: 4,
      sortOrder: SortOrder.Desc,
    } as never);

    expect(dealStats.listDealEvents).toHaveBeenCalledWith(1, {
      page: 1,
      limit: 4,
      sortOrder: SortOrder.Desc,
    });
    expect(requestLog.listForCounterparty).toHaveBeenCalledWith(
      1,
      SortOrder.Desc,
      4,
    );
    expect(page.meta.total).toBe(4);
    expect(page.items.map((item) => item.kind)).toEqual([
      'status_changed',
      'deal_requested',
      'deal_requested',
      'status_changed',
    ]);
    expect(page.items[1]).toEqual({
      kind: 'deal_requested',
      id: null,
      createdAt: new Date('2026-11-05T10:00:02Z'),
      fromStatus: null,
      toStatus: null,
      source: null,
      deal: null,
      trader: { id: TRADER, login: 'super_maks', email: 'super_maks@mail.ru' },
      requisite: null,
      request: {
        id: uuidOf(500),
        method: 'sbp',
        amountFiat: '2000.00',
        currency: 'RUB',
        result: 'created',
        statusCode: 201,
        errorCode: null,
        dealId: uuidOf(90),
      },
    });
    expect(page.items[2].request).toMatchObject({
      errorCode: 'NO_REQUISITE_FOUND_FOR_THIS_AMOUNT',
      dealId: null,
    });
    expect(page.items[2].trader).toBeNull();
  });

  it('slices a later page out of the merged events and refuses one past the window', async () => {
    const { controller, dealStats } = build();
    dealStats.listDealEvents.mockResolvedValue(
      new Page([], { total: 0, page: 1, limit: 40, pages: 0 }),
    );

    const page = await controller.dealEvents(1, {
      page: 2,
      limit: 20,
      sortOrder: SortOrder.Desc,
    } as never);

    expect(dealStats.listDealEvents).toHaveBeenCalledWith(1, {
      page: 1,
      limit: 40,
      sortOrder: SortOrder.Desc,
    });
    expect(page.items).toEqual([]);
    await expect(
      controller.dealEvents(1, {
        page: 101,
        limit: 100,
        sortOrder: SortOrder.Desc,
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
