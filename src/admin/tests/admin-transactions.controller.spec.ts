import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { Page } from '../../common/types/page';
import { AuthenticatedUser } from '../../common/types/token';
import { Transaction } from '../../transactions/entities/transaction.entity';
import { StatusEventSource } from '../../transactions/types/status-event-source.enum';
import { TransactionKind } from '../../transactions/types/transaction-kind.enum';
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
      recipientUserId: null,
      merchantId: null,
      amountFiat: 100,
      amountCrypto: 1,
      rate: 100,
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
      ...overrides,
    }) as Transaction;

  let transactions: {
    list: jest.Mock;
    findById: jest.Mock;
    transition: jest.Mock;
  };
  let directory: { findById: jest.Mock };
  let controller: AdminTransactionsController;

  beforeEach(() => {
    transactions = {
      list: jest.fn(),
      findById: jest.fn(),
      transition: jest.fn(),
    };
    directory = { findById: jest.fn() };
    controller = new AdminTransactionsController(
      transactions as never,
      directory as never,
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
