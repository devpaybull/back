import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { Page } from '../../common/types/page';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { BankDetailsType } from '../../bank-details/types/bank-details-type.enum';
import { AuthenticatedUser } from '../../common/types/token';
import { toCrypto } from '../../common/utils/to-crypto';
import { toFiat } from '../../common/utils/to-fiat';
import { toRate } from '../../common/utils/to-rate';
import { Transaction } from '../../transactions/entities/transaction.entity';
import { StatusEventSource } from '../../transactions/types/status-event-source.enum';
import { TransactionKind } from '../../transactions/types/transaction-kind.enum';
import { TransactionSortField } from '../../transactions/types/transaction-sort-field.enum';
import { TransactionStatus } from '../../transactions/types/transaction-status.enum';
import { User } from '../../users/entities/user.entity';
import { UserStatus } from '../../users/types/user-status.enum';
import { AdminTransactionsController } from '../controllers/admin-transactions.controller';
import { ChangeTransactionStatusDto } from '../dto/change-transaction-status.dto';

describe('AdminTransactionsController', () => {
  const admin: AuthenticatedUser = {
    id: uuidOf(9),
    login: 'admin@example.com',
    role: Role.Admin,
    status: UserStatus.Active,
  };

  const transaction = (overrides: Partial<Transaction> = {}): Transaction =>
    ({
      id: uuidOf(100),
      kind: TransactionKind.PayIn,
      status: TransactionStatus.Active,
      method: null,
      traderUserId: uuidOf(1),
      bankDetailsId: null,
      counterpartyId: null,
      merchantId: null,
      amountFiat: toFiat(100),
      amountCrypto: toCrypto(1),
      rate: toRate(100),
      merchantPercent: null,
      traderPercent: null,
      leadPercent: null,
      merchantCommission: null,
      traderCommission: null,
      leadCommission: null,
      traderAmount: null,
      merchantAmount: null,
      comment: null,
      createdAt: new Date(),
      resolvedAt: null,
      expiresAt: null,
      ...overrides,
    }) as Transaction;

  let transactions: {
    list: jest.Mock;
    findById: jest.Mock;
    transition: jest.Mock;
  };
  let directory: { findById: jest.Mock; findByIds: jest.Mock };
  let bankDetails: {
    findIdsOfBank: jest.Mock;
    findByIdsWithDeleted: jest.Mock;
  };
  let merchants: { findByIds: jest.Mock; rankByName: jest.Mock };
  let counterparties: { findByIds: jest.Mock };
  let controller: AdminTransactionsController;
  let cards: { cardOf: jest.Mock };
  let dealActions: Record<string, jest.Mock>;
  let payoutActions: { assignByAdmin: jest.Mock };
  let disputes: { openByAdmin: jest.Mock };

  beforeEach(() => {
    transactions = {
      list: jest.fn(),
      findById: jest.fn(),
      transition: jest.fn(),
    };
    directory = { findById: jest.fn(), findByIds: jest.fn(async () => []) };
    bankDetails = {
      findIdsOfBank: jest.fn(async () => []),
      findByIdsWithDeleted: jest.fn(async () => []),
    };
    merchants = {
      findByIds: jest.fn(async () => []),
      rankByName: jest.fn(async () => new Map()),
    };
    counterparties = { findByIds: jest.fn(async () => []) };
    cards = { cardOf: jest.fn() };
    dealActions = {
      close: jest.fn(async () => transaction()),
      changeAmount: jest.fn(async () => transaction()),
      cancelSettled: jest.fn(async () => transaction()),
      restore: jest.fn(async () => transaction()),
      cancelPayout: jest.fn(async () => transaction()),
      sendCallback: jest.fn(),
    };
    payoutActions = { assignByAdmin: jest.fn(async () => transaction()) };
    disputes = { openByAdmin: jest.fn(async () => transaction()) };
    controller = new AdminTransactionsController(
      transactions as never,
      directory as never,
      bankDetails as never,
      merchants as never,
      counterparties as never,
      { getOrThrow: () => 'Europe/Moscow' } as never,
      { listOf: jest.fn(async () => []) } as never,
      { findByIds: jest.fn(async () => []) } as never,
      cards as never,
      dealActions as never,
      payoutActions as never,
      disputes as never,
    );
  });

  it('is guarded for admin and superadmin only', () => {
    expect(
      Reflect.getMetadata(ROLES_METADATA_KEY, AdminTransactionsController),
    ).toEqual([Role.Admin, Role.Superadmin]);
  });

  it('marks only the status change as a write', () => {
    expect(
      Reflect.getMetadata(WRITE_ACCESS_METADATA_KEY, controller.changeStatus),
    ).toBe(true);
    expect(
      Reflect.getMetadata(WRITE_ACCESS_METADATA_KEY, controller.list),
    ).toBeUndefined();
  });

  describe('list', () => {
    it('maps the page to transaction DTOs', async () => {
      transactions.list.mockResolvedValue(
        new Page([transaction()], { total: 1, page: 1, limit: 20, pages: 1 }),
      );

      const page = await controller.list({} as never);

      expect(page.items[0].id).toBe(uuidOf(100));
      expect(page.meta.total).toBe(1);
    });
  });

  describe('list, the deals tab', () => {
    const page = (rows: Transaction[]) =>
      new Page(rows, { total: rows.length, page: 1, limit: 20, pages: 1 });

    const query = (overrides: Record<string, unknown> = {}) =>
      ({
        page: 1,
        limit: 20,
        sortBy: TransactionSortField.CreatedAt,
        sortOrder: SortOrder.Desc,
        ...overrides,
      }) as never;

    it('asks the requisites owner which requisites are at the bank, and filters the list by them', async () => {
      transactions.list.mockResolvedValue(page([]));
      bankDetails.findIdsOfBank.mockResolvedValue([uuidOf(40), uuidOf(41)]);

      await controller.list(query({ bankId: 7 }));

      expect(bankDetails.findIdsOfBank).toHaveBeenCalledWith(7);
      expect(transactions.list).toHaveBeenCalledWith(
        expect.objectContaining({
          bankDetailsIds: [uuidOf(40), uuidOf(41)],
        }),
      );
    });

    it('passes an empty requisite list through when the bank has none, so the page is empty', async () => {
      transactions.list.mockResolvedValue(page([]));

      await controller.list(query({ bankId: 7 }));

      expect(transactions.list).toHaveBeenCalledWith(
        expect.objectContaining({ bankDetailsIds: [] }),
      );
    });

    it('does not ask about requisites without a bank filter', async () => {
      transactions.list.mockResolvedValue(page([]));

      await controller.list(query());

      expect(bankDetails.findIdsOfBank).not.toHaveBeenCalled();
      expect(transactions.list).toHaveBeenCalledWith(
        expect.objectContaining({ bankDetailsIds: undefined }),
      );
    });

    it('hands the fiat amount bounds to the list as exact fiat amounts', async () => {
      transactions.list.mockResolvedValue(page([]));

      await controller.list(query({ amountFrom: '1000.50', amountTo: '2500' }));

      expect(transactions.list).toHaveBeenCalledWith(
        expect.objectContaining({
          amountFrom: toFiat('1000.50'),
          amountTo: toFiat('2500'),
        }),
      );
    });

    it('reads a bare day as midnight in the business timezone and a date-time as written', async () => {
      transactions.list.mockResolvedValue(page([]));

      await controller.list(
        query({
          createdFrom: '2026-10-24',
          createdTo: '2026-10-24T18:00:00Z',
        }),
      );

      expect(transactions.list).toHaveBeenCalledWith(
        expect.objectContaining({
          createdFrom: new Date('2026-10-23T21:00:00.000Z'),
          createdTo: new Date('2026-10-24T18:00:00.000Z'),
        }),
      );
    });

    it('leaves absent amount bounds absent', async () => {
      transactions.list.mockResolvedValue(page([]));

      await controller.list(query());

      expect(transactions.list).toHaveBeenCalledWith(
        expect.objectContaining({ amountFrom: undefined, amountTo: undefined }),
      );
    });

    it('hands the merchant name ranking to the list only for a merchant sort', async () => {
      const ranks = new Map([[uuidOf(3), 0]]);
      merchants.rankByName.mockResolvedValue(ranks);
      transactions.list.mockResolvedValue(page([]));

      await controller.list(query({ sortBy: TransactionSortField.Merchant }));
      expect(transactions.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ merchantRanks: ranks }),
      );

      merchants.rankByName.mockClear();
      await controller.list(query({ sortBy: TransactionSortField.AmountFiat }));
      expect(merchants.rankByName).not.toHaveBeenCalled();
      expect(transactions.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ merchantRanks: undefined }),
      );
    });

    it('enriches every row in one query per source, whatever the row count', async () => {
      const rows = [
        transaction({
          id: uuidOf(101),
          traderUserId: uuidOf(1),
          merchantId: uuidOf(3),
          bankDetailsId: uuidOf(40),
          counterpartyId: 5,
        }),
        transaction({
          id: uuidOf(102),
          traderUserId: uuidOf(1),
          merchantId: uuidOf(3),
          bankDetailsId: uuidOf(40),
          counterpartyId: 5,
        }),
        transaction({
          id: uuidOf(103),
          traderUserId: uuidOf(2),
          merchantId: uuidOf(4),
          bankDetailsId: uuidOf(41),
          counterpartyId: null,
        }),
      ];
      transactions.list.mockResolvedValue(page(rows));
      directory.findByIds.mockResolvedValue([
        {
          id: uuidOf(1),
          telegramUsername: 'mark',
          email: null,
          telegramGroups: 'Mark / trade_paybull',
        },
        {
          id: uuidOf(2),
          telegramUsername: null,
          email: 'two@example.com',
          telegramGroups: null,
        },
      ]);
      merchants.findByIds.mockResolvedValue([
        { id: uuidOf(3), name: 'Acme' },
        { id: uuidOf(4), name: 'Zeta' },
      ]);
      bankDetails.findByIdsWithDeleted.mockResolvedValue([
        {
          id: uuidOf(40),
          type: BankDetailsType.CardOrSbp,
          card: null,
          phone: '+79990000000',
          cardholderName: 'Ivan I.',
          bank: { id: 7, name: 'Sber', bankId: 'sber' },
        },
        {
          id: uuidOf(41),
          type: BankDetailsType.CardOrSbp,
          card: '4111111111111111',
          phone: null,
          cardholderName: null,
          bank: { id: 8, name: 'T-Bank', bankId: 'tbank' },
        },
      ]);
      counterparties.findByIds.mockResolvedValue([
        { id: 5, name: 'Client A', externalId: 'x' },
      ]);

      const result = await controller.list(query());

      expect(directory.findByIds).toHaveBeenCalledTimes(1);
      expect(directory.findByIds).toHaveBeenCalledWith([uuidOf(1), uuidOf(2)]);
      expect(merchants.findByIds).toHaveBeenCalledTimes(1);
      expect(merchants.findByIds).toHaveBeenCalledWith([uuidOf(3), uuidOf(4)]);
      expect(bankDetails.findByIdsWithDeleted).toHaveBeenCalledTimes(1);
      expect(bankDetails.findByIdsWithDeleted).toHaveBeenCalledWith([
        uuidOf(40),
        uuidOf(41),
      ]);
      expect(counterparties.findByIds).toHaveBeenCalledTimes(1);
      expect(counterparties.findByIds).toHaveBeenCalledWith([5]);

      expect(result.items[0]).toEqual(
        expect.objectContaining({
          id: uuidOf(101),
          trader: {
            id: uuidOf(1),
            login: 'mark',
            telegramUsername: 'mark',
            telegramGroups: 'Mark / trade_paybull',
          },
          merchant: { id: uuidOf(3), name: 'Acme' },
          bankDetails: {
            id: uuidOf(40),
            type: BankDetailsType.CardOrSbp,
            card: null,
            phone: '+79990000000',
            cardholderName: 'Ivan I.',
            bank: { id: 7, name: 'Sber' },
            mobileOperator: null,
          },
          counterparty: { id: 5, name: 'Client A' },
        }),
      );
      expect(result.items[2]).toEqual(
        expect.objectContaining({
          trader: {
            id: uuidOf(2),
            login: 'two@example.com',
            telegramUsername: null,
            telegramGroups: null,
          },
          counterparty: null,
          bankDetails: expect.objectContaining({
            bank: { id: 8, name: 'T-Bank' },
          }),
        }),
      );
      expect(result.meta.total).toBe(3);
    });

    it('answers null for every part a row does not have', async () => {
      transactions.list.mockResolvedValue(
        page([
          transaction({
            merchantId: null,
            bankDetailsId: null,
            counterpartyId: null,
          }),
        ]),
      );

      const result = await controller.list(query());

      expect(merchants.findByIds).toHaveBeenCalledWith([]);
      expect(bankDetails.findByIdsWithDeleted).toHaveBeenCalledWith([]);
      expect(counterparties.findByIds).toHaveBeenCalledWith([]);
      expect(result.items[0]).toEqual(
        expect.objectContaining({
          trader: null,
          merchant: null,
          bankDetails: null,
          counterparty: null,
          expiresAt: null,
        }),
      );
    });

    it('answers trader null for a pay-out nobody has taken yet', async () => {
      transactions.list.mockResolvedValue(
        page([
          transaction({
            kind: TransactionKind.PayOut,
            status: TransactionStatus.Pending,
            traderUserId: null,
          }),
        ]),
      );

      const result = await controller.list(query());

      expect(directory.findByIds).toHaveBeenCalledWith([]);
      expect(result.items[0]).toEqual(
        expect.objectContaining({ traderUserId: null, trader: null }),
      );
    });

    it('carries the deal deadline on the row', async () => {
      const expiresAt = new Date('2026-10-24T12:20:00.000Z');
      transactions.list.mockResolvedValue(page([transaction({ expiresAt })]));

      const result = await controller.list(query());

      expect(result.items[0].expiresAt).toBe(expiresAt);
    });
  });

  describe('findOne', () => {
    it('404 when the transaction is unknown', async () => {
      cards.cardOf.mockRejectedValue(new NotFoundException());

      await expect(
        controller.findOne(uuidOf(100), { role: Role.Admin } as never),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('changeStatus', () => {
    const dto: ChangeTransactionStatusDto = {
      status: TransactionStatus.Success,
      reason: 'confirmed',
    };

    it('404 when the transaction is unknown', async () => {
      transactions.findById.mockResolvedValue(null);

      await expect(
        controller.changeStatus(uuidOf(100), dto, admin),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('403 when the admin owns the transaction (self-edit)', async () => {
      transactions.findById.mockResolvedValue(
        transaction({ traderUserId: admin.id }),
      );

      await expect(
        controller.changeStatus(uuidOf(100), dto, admin),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(transactions.transition).not.toHaveBeenCalled();
    });

    it('403 when the trader outranks what the admin may act on', async () => {
      transactions.findById.mockResolvedValue(transaction());
      directory.findById.mockResolvedValue({ role: Role.Superadmin } as User);

      await expect(
        controller.changeStatus(uuidOf(100), dto, admin),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(transactions.transition).not.toHaveBeenCalled();
    });

    it('looks no trader up for a pay-out nobody has taken yet', async () => {
      transactions.findById.mockResolvedValue(
        transaction({
          kind: TransactionKind.PayOut,
          status: TransactionStatus.Pending,
          traderUserId: null,
        }),
      );
      transactions.transition.mockResolvedValue(
        transaction({
          kind: TransactionKind.PayOut,
          status: TransactionStatus.Canceled,
          traderUserId: null,
        }),
      );

      const result = await controller.changeStatus(
        uuidOf(100),
        { status: TransactionStatus.Canceled, reason: 'no trader' },
        admin,
      );

      expect(directory.findById).not.toHaveBeenCalled();
      expect(result.traderUserId).toBeNull();
    });

    it('transitions with source admin, the acting admin and the reason', async () => {
      transactions.findById.mockResolvedValue(transaction());
      directory.findById.mockResolvedValue({ role: Role.Trader } as User);
      transactions.transition.mockResolvedValue(
        transaction({ status: TransactionStatus.Success }),
      );

      const result = await controller.changeStatus(uuidOf(100), dto, admin);

      expect(transactions.transition).toHaveBeenCalledWith(uuidOf(100), {
        toStatus: TransactionStatus.Success,
        source: StatusEventSource.Admin,
        actorUserId: admin.id,
        reason: 'confirmed',
      });
      expect(result.status).toBe(TransactionStatus.Success);
    });
  });

  describe('the admin pages: filters, counters, export, card and actions', () => {
    const query = (overrides: Record<string, unknown> = {}) =>
      ({
        page: 1,
        limit: 20,
        sortBy: TransactionSortField.CreatedAt,
        sortOrder: SortOrder.Desc,
        ...overrides,
      }) as never;
    const admin = { id: uuidOf(9), role: Role.Admin } as AuthenticatedUser;
    const extra = () => {
      const more = {
        findIdsOfGroup: jest.fn(async () => [uuidOf(3), uuidOf(4)]),
        findIdsByReference: jest.fn(async () => [5]),
        findIdsMatching: jest.fn(async () => [uuidOf(40)]),
        countsByMethod: jest.fn(async () => new Map([['sbp', 3]])),
        listForExport: jest.fn(async () => [transaction()]),
      };
      Object.assign(merchants, { findIdsOfGroup: more.findIdsOfGroup });
      Object.assign(counterparties, {
        findIdsByReference: more.findIdsByReference,
      });
      Object.assign(bankDetails, { findIdsMatching: more.findIdsMatching });
      Object.assign(transactions, {
        countsByMethod: more.countsByMethod,
        listForExport: more.listForExport,
      });
      transactions.list.mockResolvedValue(
        new Page([], { total: 0, page: 1, limit: 20, pages: 0 }),
      );

      return more;
    };

    it('turns every filter into the owners’ ids, and no period into all time', async () => {
      const more = extra();

      await controller.list(
        query({
          status: [TransactionStatus.Active, TransactionStatus.ManualReview],
          merchantGroupId: 2,
          merchantId: uuidOf(4),
          counterparty: 'payer-1',
          requisite: '4455',
          search: 'order-77',
        }),
      );

      expect(more.findIdsMatching).toHaveBeenCalledWith('4455', true);
      expect(transactions.list).toHaveBeenCalledWith(
        expect.objectContaining({
          statuses: [TransactionStatus.Active, TransactionStatus.ManualReview],
          merchantIds: [uuidOf(4)],
          counterpartyIds: [5],
          search: 'order-77',
          requisite: { bankDetailsIds: [uuidOf(40)], text: '4455' },
        }),
      );
      expect(transactions.list.mock.calls[0][0].createdFrom).toBeUndefined();
      expect(transactions.list.mock.calls[0][0].createdTo).toBeUndefined();
    });

    it('a period becomes a range in the business time zone', async () => {
      extra();

      await controller.list(query({ period: 'today' }));

      const { createdFrom, createdTo } = transactions.list.mock.calls[0][0];
      expect(createdFrom).toBeInstanceOf(Date);
      expect(createdTo.getTime()).toBeGreaterThan(createdFrom.getTime());
    });

    it('counts every method the kind works in, zeros included, without the method filter', async () => {
      const more = extra();

      const counters = await controller.counters({
        kind: TransactionKind.PayOut,
        method: 'card',
      } as never);

      expect(
        (
          more.countsByMethod.mock.calls as unknown as [{ method?: string }][]
        )[0][0].method,
      ).toBeUndefined();
      expect(counters).toEqual({ all: 3, byMethod: { sbp: 3, card: 0 } });
    });

    it('exports the filtered rows as CSV', async () => {
      extra();

      const file = await controller.export({} as never);
      const text = await new Promise<string>((resolve) => {
        const chunks: Buffer[] = [];
        file
          .getStream()
          .on('data', (chunk: Buffer) => chunks.push(chunk))
          .on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      });

      expect(text.split('\r\n')[0]).toMatch(/^id,merchantTransactionId,kind/);
      expect(text).toContain(uuidOf(100));
    });

    it('marks every action a write, and the money ones superadmin only', () => {
      for (const handler of [
        controller.close,
        controller.changeAmount,
        controller.cancelSettled,
        controller.restore,
        controller.cancelPayout,
        controller.assign,
        controller.openDispute,
        controller.sendCallback,
      ]) {
        expect(Reflect.getMetadata(WRITE_ACCESS_METADATA_KEY, handler)).toBe(
          true,
        );
      }
      for (const handler of [
        controller.changeAmount,
        controller.cancelSettled,
        controller.restore,
      ]) {
        expect(Reflect.getMetadata(ROLES_METADATA_KEY, handler)).toEqual([
          Role.Superadmin,
        ]);
      }
      expect(
        Reflect.getMetadata(ROLES_METADATA_KEY, controller.close),
      ).toBeUndefined();
    });

    it('an admin may not act on their own deal, nor on an admin’s', async () => {
      transactions.findById.mockResolvedValue(
        transaction({ traderUserId: admin.id }),
      );
      await expect(controller.close(uuidOf(100), admin)).rejects.toBeInstanceOf(
        ForbiddenException,
      );

      transactions.findById.mockResolvedValue(transaction());
      directory.findById.mockResolvedValue({ role: Role.Admin });
      await expect(controller.close(uuidOf(100), admin)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(dealActions.close).not.toHaveBeenCalled();
    });

    it('passes the amount and the overdraft flag through', async () => {
      transactions.findById.mockResolvedValue(transaction());
      directory.findById.mockResolvedValue({ role: Role.Trader });

      await controller.changeAmount(
        uuidOf(100),
        { amountFiat: '1500.00', reason: 'чек' },
        admin,
      );

      expect(dealActions.changeAmount).toHaveBeenCalledWith(
        { userId: admin.id },
        uuidOf(100),
        {
          amountFiat: toFiat('1500.00'),
          reason: 'чек',
          confirmOverdraft: false,
        },
      );
    });

    it('a dispute needs its receipt; an admin is not assigned their own pay-out', async () => {
      await expect(
        controller.openDispute(uuidOf(100), {}, admin, undefined),
      ).rejects.toThrow('The receipt file is required');
      await expect(
        controller.assign(uuidOf(100), { traderUserId: admin.id }, admin),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('the card merges the status events and the disputes, newest first', async () => {
      const at = (minute: number) =>
        new Date(`2026-11-14T10:${String(minute).padStart(2, '0')}:00Z`);
      cards.cardOf.mockResolvedValue({
        deal: transaction(),
        events: [
          {
            createdAt: at(1),
            fromStatus: null,
            toStatus: TransactionStatus.Active,
            source: StatusEventSource.System,
            actorUserId: null,
            reason: null,
          },
          {
            createdAt: at(9),
            fromStatus: TransactionStatus.Active,
            toStatus: TransactionStatus.Success,
            source: StatusEventSource.Admin,
            actorUserId: uuidOf(9),
            reason: null,
          },
        ],
        disputes: [
          {
            id: 4,
            status: 'rejected',
            statusBefore: TransactionStatus.Success,
            openedAt: at(5),
            resolvedAt: null,
          },
        ],
        leadShares: [
          { leadUserId: uuidOf(7), percent: 1, amount: toCrypto('0.2') },
        ],
        files: [],
        actions: ['send_callback'],
      });
      directory.findByIds.mockResolvedValue([
        { id: uuidOf(9), telegramUsername: 'boss', role: Role.Admin },
        { id: uuidOf(7), telegramUsername: 'lead', role: Role.LeadTrader },
      ]);

      const card = await controller.findOne(uuidOf(100), admin);

      expect(card.history.map((entry) => entry.kind)).toEqual([
        'status',
        'dispute_opened',
        'status',
      ]);
      expect(card.history[0].actor).toEqual({
        id: uuidOf(9),
        login: 'boss',
        role: Role.Admin,
      });
      expect(card.leadShares).toEqual([
        {
          leadUserId: uuidOf(7),
          login: 'lead',
          percent: 1,
          amount: '0.200000',
        },
      ]);
      expect(card.actions).toEqual(['send_callback']);
      expect(cards.cardOf).toHaveBeenCalledWith(uuidOf(100), false);
    });
  });
});
