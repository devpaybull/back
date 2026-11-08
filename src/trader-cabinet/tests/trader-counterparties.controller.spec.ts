import { NotFoundException } from '@nestjs/common';
import { BankDetailsStatus } from '../../bank-details/types/bank-details-status.enum';
import { BankDetailsType } from '../../bank-details/types/bank-details-type.enum';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { Page } from '../../common/types/page';
import { AuthenticatedUser } from '../../common/types/token';
import { toFiat } from '../../common/utils/to-fiat';
import { TraderCounterpartySortField } from '../../counterparties/types/trader-counterparty-sort-field.enum';
import { UserStatus } from '../../users/types/user-status.enum';
import { TraderCounterpartiesController } from '../controllers/trader-counterparties.controller';

const trader: AuthenticatedUser = {
  id: uuidOf(1),
  login: 'trader',
  role: Role.Trader,
  status: UserStatus.Active,
  impersonatedBy: uuidOf(9),
};

const REQ_A = uuidOf(30);
const REQ_B = uuidOf(31);

const build = () => {
  const bankDetails = {
    ownCounterpartyOnlyIds: jest.fn(async () => [REQ_A, REQ_B]),
    listOwnCounterpartyOnly: jest.fn(
      async () =>
        new Page(
          [
            {
              id: REQ_A,
              type: BankDetailsType.CardOrSbp,
              bank: { id: 3, name: 'Т-банк' },
              cardholderName: 'IVAN IVANOV',
              phone: '+79010000001',
              card: null,
              active: true,
              bannedAt: null,
              maxCounterparties: 8,
            },
            {
              id: REQ_B,
              type: BankDetailsType.CardOrSbp,
              bank: { id: 3, name: 'Т-банк' },
              cardholderName: null,
              phone: '+79010000002',
              card: null,
              active: false,
              bannedAt: null,
              maxCounterparties: 2,
            },
          ],
          { total: 2, page: 1, limit: 20, pages: 1 },
        ),
    ),
    findIdsOfUsers: jest.fn(async () => [REQ_A, REQ_B, uuidOf(32)]),
    moveOwnCounterparty: jest.fn(async () => ({ id: 7, bankDetailsId: REQ_B })),
  };
  const counterparties = {
    unbind: jest.fn(async () => ({})),
  };
  const traderCounterparties = {
    totalsByRequisite: jest.fn(async () => [
      {
        bankDetailsId: REQ_A,
        bound: 1,
        completedCount: 8,
        paidCount: 4,
        paidAmount: toFiat('200002.00'),
        deposits30d: toFiat('1000.25'),
      },
      {
        bankDetailsId: REQ_B,
        bound: 1,
        completedCount: 2,
        paidCount: 0,
        paidAmount: toFiat(0),
        deposits30d: toFiat(0),
      },
    ]),
    page: jest.fn(
      async () =>
        new Page(
          [
            {
              id: 7,
              bankDetailsId: REQ_A,
              active: true,
              completedCount: 8,
              paidCount: 4,
              paidAmount: toFiat('200002.00'),
              lastDealAt: new Date('2026-11-07T10:00:00Z'),
            },
            {
              id: 8,
              bankDetailsId: REQ_B,
              active: false,
              completedCount: 0,
              paidCount: 0,
              paidAmount: toFiat(0),
              lastDealAt: null,
            },
          ],
          { total: 2, page: 1, limit: 20, pages: 1 },
        ),
    ),
  };
  const controller = new TraderCounterpartiesController(
    bankDetails as never,
    counterparties as never,
    traderCounterparties as never,
  );

  return { controller, bankDetails, counterparties, traderCounterparties };
};

describe('TraderCounterpartiesController', () => {
  it('is the trader’s alone, and the two writes are marked', () => {
    expect(
      Reflect.getMetadata(ROLES_METADATA_KEY, TraderCounterpartiesController),
    ).toEqual([Role.Trader]);
    for (const handler of ['move', 'remove'] as const) {
      expect(
        Reflect.getMetadata(
          WRITE_ACCESS_METADATA_KEY,
          TraderCounterpartiesController.prototype[handler],
        ),
      ).toBe(true);
    }
  });

  it('sums the cards over the clients bound to the trader’s own requisites', async () => {
    const { controller, bankDetails, traderCounterparties } = build();

    expect(await controller.summary(trader, { bankDetailsId: REQ_A })).toEqual({
      total: 2,
      averageConversion: 40,
      deposits30d: '1000.25',
      averageCheck: '50000.50',
    });
    expect(bankDetails.ownCounterpartyOnlyIds).toHaveBeenCalledWith(
      trader.id,
      REQ_A,
    );
    expect(traderCounterparties.totalsByRequisite).toHaveBeenCalledWith(
      trader.id,
      [REQ_A, REQ_B],
      expect.any(Date),
    );
  });

  it('shows each requisite with its slots and deposits, never a client id of the merchant', async () => {
    const { controller } = build();

    const page = await controller.groups(trader, {
      page: 1,
      limit: 20,
      sortOrder: SortOrder.Desc,
    });

    expect(page.items).toEqual([
      {
        requisite: {
          id: REQ_A,
          type: BankDetailsType.CardOrSbp,
          bank: { id: 3, name: 'Т-банк' },
          cardholderName: 'IVAN IVANOV',
          phone: '+79010000001',
          card: null,
          status: BankDetailsStatus.Active,
        },
        slots: { bound: 1, max: 8 },
        deposits30d: '1000.25',
      },
      expect.objectContaining({
        requisite: expect.objectContaining({
          status: BankDetailsStatus.Disabled,
        }),
        slots: { bound: 1, max: 2 },
        deposits30d: '0.00',
      }),
    ]);
  });

  it('lists the clients with the internal id, active or inactive only, and the trader-scoped figures', async () => {
    const { controller, traderCounterparties } = build();

    const page = await controller.list(trader, {
      page: 1,
      limit: 20,
      sortOrder: SortOrder.Desc,
      sortBy: TraderCounterpartySortField.Volume,
      hideInactive: true,
    });

    expect(page.items).toEqual([
      {
        id: 7,
        bankDetailsId: REQ_A,
        status: 'active',
        conversion: 50,
        paidCount: 4,
        completedCount: 8,
        averageCheck: '50000.50',
        volume: '200002.00',
        lastDealAt: new Date('2026-11-07T10:00:00Z'),
      },
      {
        id: 8,
        bankDetailsId: REQ_B,
        status: 'inactive',
        conversion: null,
        paidCount: 0,
        completedCount: 0,
        averageCheck: null,
        volume: '0.00',
        lastDealAt: null,
      },
    ]);
    expect(Object.keys(page.items[0])).not.toContain('externalId');
    expect(traderCounterparties.page).toHaveBeenCalledWith(
      trader.id,
      [REQ_A, REQ_B],
      {
        page: 1,
        limit: 20,
        sortBy: TraderCounterpartySortField.Volume,
        sortOrder: SortOrder.Desc,
        hideInactive: true,
      },
      expect.any(Date),
    );
  });

  it('moves through the requisites’ owner, naming the impersonator', async () => {
    const { controller, bankDetails } = build();

    expect(await controller.move(trader, 7, { bankDetailsId: REQ_B })).toEqual({
      id: 7,
      bankDetailsId: REQ_B,
    });
    expect(bankDetails.moveOwnCounterparty).toHaveBeenCalledWith(
      trader.id,
      7,
      REQ_B,
      uuidOf(9),
    );
  });

  it('unbinds only a client bound to one of the trader’s requisites', async () => {
    const { controller, counterparties, bankDetails } = build();

    expect(await controller.remove(trader, 7)).toBeNull();
    expect(bankDetails.findIdsOfUsers).toHaveBeenCalledWith([trader.id]);
    expect(counterparties.unbind).toHaveBeenCalledWith(7, trader.id, {
      boundToAnyOf: [REQ_A, REQ_B, uuidOf(32)],
      impersonatorUserId: uuidOf(9),
    });
  });

  it('answers 404 for an id no int column can hold', async () => {
    const { controller, counterparties, bankDetails } = build();

    await expect(controller.remove(trader, 2 ** 31)).rejects.toThrow(
      NotFoundException,
    );
    await expect(
      controller.move(trader, 0, { bankDetailsId: REQ_B }),
    ).rejects.toThrow(NotFoundException);
    expect(counterparties.unbind).not.toHaveBeenCalled();
    expect(bankDetails.moveOwnCounterparty).not.toHaveBeenCalled();
  });
});
