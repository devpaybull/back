import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { AuthenticatedUser } from '../../common/types/token';
import { Transaction } from '../../transactions/entities/transaction.entity';
import { Wallet } from '../../transactions/entities/wallet.entity';
import { StatusEventSource } from '../../transactions/types/status-event-source.enum';
import { TransactionKind } from '../../transactions/types/transaction-kind.enum';
import { TransactionStatus } from '../../transactions/types/transaction-status.enum';
import { User } from '../../users/entities/user.entity';
import { UserStatus } from '../../users/types/user-status.enum';
import { AdminBalancesController } from '../controllers/admin-balances.controller';
import { AdminTransferDto } from '../dto/admin-transfer.dto';

describe('AdminBalancesController', () => {
  const admin: AuthenticatedUser = {
    id: uuidOf(9),
    login: 'admin@example.com',
    role: Role.Admin,
    status: UserStatus.Active,
  };

  const sender = { id: uuidOf(1), role: Role.Trader } as User;

  const wallet = (overrides: Partial<Wallet> = {}): Wallet =>
    ({
      id: 1,
      userId: uuidOf(1),
      mainBalance: 100,
      mainReserved: 30,
      insurancePayInBalance: 500,
      insurancePayOutBalance: 0,
      insurancePayInReserved: 0,
      insurancePayOutReserved: 0,
      lastAcceptedDealAt: null,
      ...overrides,
    }) as Wallet;

  let wallets: { findByUserId: jest.Mock };
  let transactions: { createInternalTransfer: jest.Mock };
  let directory: { findById: jest.Mock; findByLogin: jest.Mock };
  let controller: AdminBalancesController;

  beforeEach(() => {
    wallets = { findByUserId: jest.fn() };
    transactions = { createInternalTransfer: jest.fn() };
    directory = { findById: jest.fn(), findByLogin: jest.fn() };
    controller = new AdminBalancesController(
      wallets as never,
      transactions as never,
      directory as never,
    );
  });

  it('is guarded for admin and superadmin only', () => {
    expect(
      Reflect.getMetadata(ROLES_METADATA_KEY, AdminBalancesController),
    ).toEqual([Role.Admin, Role.Superadmin]);
  });

  it('marks only the transfer as a write', () => {
    expect(
      Reflect.getMetadata(WRITE_ACCESS_METADATA_KEY, controller.transfer),
    ).toBe(true);
    expect(
      Reflect.getMetadata(WRITE_ACCESS_METADATA_KEY, controller.balances),
    ).toBeUndefined();
  });

  describe('balances', () => {
    it('404 when the user is unknown', async () => {
      directory.findById.mockResolvedValue(null);

      await expect(controller.balances(uuidOf(1))).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('404 when the user has no wallet', async () => {
      directory.findById.mockResolvedValue(sender);
      wallets.findByUserId.mockResolvedValue(null);

      await expect(controller.balances(uuidOf(1))).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('reports available main as balance minus reserved', async () => {
      directory.findById.mockResolvedValue(sender);
      wallets.findByUserId.mockResolvedValue(wallet());

      const result = await controller.balances(uuidOf(1));

      expect(result.availableMain).toBe(70);
      expect(result.mainBalance).toBe(100);
    });
  });

  describe('transfer', () => {
    const dto: AdminTransferDto = { recipient: 'lead@example.com', amount: 50 };

    it('403 when the admin transfers from their own account', async () => {
      await expect(
        controller.transfer(admin.id, dto, admin),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('404 when the sender is unknown', async () => {
      directory.findById.mockResolvedValue(null);

      await expect(
        controller.transfer(uuidOf(1), dto, admin),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('403 when the sender outranks what the admin may act on', async () => {
      directory.findById.mockResolvedValue({ role: Role.Superadmin } as User);

      await expect(
        controller.transfer(uuidOf(1), dto, admin),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('404 when the recipient login resolves to nobody', async () => {
      directory.findById.mockResolvedValue(sender);
      directory.findByLogin.mockResolvedValue(null);

      await expect(
        controller.transfer(uuidOf(1), dto, admin),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('400 when the recipient is not a trader or lead trader', async () => {
      directory.findById.mockResolvedValue(sender);
      directory.findByLogin.mockResolvedValue({ role: Role.Merchant } as User);

      await expect(
        controller.transfer(uuidOf(1), dto, admin),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(transactions.createInternalTransfer).not.toHaveBeenCalled();
    });

    it('creates the transfer with source admin and the acting admin', async () => {
      directory.findById.mockResolvedValue(sender);
      directory.findByLogin.mockResolvedValue({
        id: uuidOf(2),
        role: Role.LeadTrader,
      } as User);
      transactions.createInternalTransfer.mockResolvedValue({
        id: uuidOf(100),
        kind: TransactionKind.InternalTransfer,
        status: TransactionStatus.Success,
        traderUserId: uuidOf(1),
        recipientUserId: uuidOf(2),
        amountCrypto: 50,
        createdAt: new Date(),
      } as Transaction);

      const result = await controller.transfer(uuidOf(1), dto, admin);

      expect(transactions.createInternalTransfer).toHaveBeenCalledWith({
        fromUserId: uuidOf(1),
        toUserId: uuidOf(2),
        amount: 50,
        source: StatusEventSource.Admin,
        actorUserId: admin.id,
        comment: undefined,
      });
      expect(result.status).toBe(TransactionStatus.Success);
    });
  });
});
