import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { Page } from '../../common/types/page';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { TransactionType } from '../../common/enums/transaction-type.enum';
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
    controller = new AdminTransactionsController(
      transactions as never,
      directory as never,
      bankDetails as never,
      merchants as never,
      counterparties as never,
      { getOrThrow: () => 'Europe/Moscow' } as never,
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
          bankId: 7,
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
          type: TransactionType.Sbp,
          card: null,
          phone: '+79990000000',
          cardholderName: 'Ivan I.',
          bank: { id: 7, name: 'Sber', bankId: 'sber' },
        },
        {
          id: uuidOf(41),
          type: TransactionType.Card,
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
            telegramGroups: 'Mark / trade_paybull',
          },
          merchant: { id: uuidOf(3), name: 'Acme' },
          bankDetails: {
            id: uuidOf(40),
            type: TransactionType.Sbp,
            card: null,
            phone: '+79990000000',
            cardholderName: 'Ivan I.',
            bank: { id: 7, name: 'Sber' },
          },
          counterparty: { id: 5, name: 'Client A' },
        }),
      );
      expect(result.items[2]).toEqual(
        expect.objectContaining({
          trader: {
            id: uuidOf(2),
            login: 'two@example.com',
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

    it('carries the deal deadline on the row', async () => {
      const expiresAt = new Date('2026-10-24T12:20:00.000Z');
      transactions.list.mockResolvedValue(page([transaction({ expiresAt })]));

      const result = await controller.list(query());

      expect(result.items[0].expiresAt).toBe(expiresAt);
    });
  });

  describe('findOne', () => {
    it('404 when the transaction is unknown', async () => {
      transactions.findById.mockResolvedValue(null);

      await expect(controller.findOne(uuidOf(100))).rejects.toBeInstanceOf(
        NotFoundException,
      );
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
});
