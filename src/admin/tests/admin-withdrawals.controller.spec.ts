import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { AccountTransaction } from '../../account-transactions/entities/account-transaction.entity';
import { AccountTransactionStatus } from '../../account-transactions/types/account-transaction-status.enum';
import { AccountTransactionStatusReason } from '../../account-transactions/types/account-transaction-status-reason.enum';
import { AccountTransactionType } from '../../account-transactions/types/account-transaction-type.enum';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { toPage } from '../../common/types/page';
import { AuthenticatedUser } from '../../common/types/token';
import { toCrypto } from '../../common/utils/to-crypto';
import { OutgoingTransferStatus } from '../../tron/types/outgoing-transfer-status.enum';
import { User } from '../../users/entities/user.entity';
import { UserStatus } from '../../users/types/user-status.enum';
import { AdminWithdrawalsController } from '../controllers/admin-withdrawals.controller';
import { ListAccountTransactionsQueryDto } from '../dto/list-account-transactions-query.dto';
import { ACCOUNT_TRANSACTIONS_EXPORT_MAX_ROWS } from '../utils/account-transactions-export-max-rows';

const TRADER = uuidOf(1);
const HASH = 'b'.repeat(64);
const EXTERNAL = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const admin: AuthenticatedUser = {
  id: uuidOf(9),
  login: 'admin',
  role: Role.Admin,
  status: UserStatus.Active,
};

const withdrawal = (
  overrides: Partial<AccountTransaction> = {},
): AccountTransaction =>
  ({
    id: 41,
    type: AccountTransactionType.Withdrawal,
    status: AccountTransactionStatus.Failed,
    statusReason: AccountTransactionStatusReason.NetworkFailed,
    userId: TRADER,
    amount: toCrypto(100),
    fee: toCrypto('0.25'),
    address: EXTERNAL,
    txHash: null,
    comment: null,
    paidManually: false,
    actorUserId: null,
    createdAt: new Date('2026-10-25T10:00:00Z'),
    completedAt: null,
    ...overrides,
  }) as AccountTransaction;

const query = (): ListAccountTransactionsQueryDto =>
  Object.assign(new ListAccountTransactionsQueryDto(), { page: 1, limit: 20 });

const build = (mode = 'auto') => {
  const config = {
    get: jest.fn((key: string, fallback?: unknown) =>
      key === 'PAYOUT_MODE' ? mode : fallback,
    ),
    getOrThrow: jest.fn(() => 'Europe/Moscow'),
  };
  const operations = {
    list: jest.fn(async () =>
      toPage([[withdrawal()], 1], { page: 1, limit: 20 }),
    ),
    userIdsOf: jest.fn(async () => [TRADER]),
    attemptsOf: jest.fn(
      async () =>
        new Map([
          [41, [{ txHash: HASH, status: OutgoingTransferStatus.Failed }]],
        ]),
    ),
    stats: jest.fn(),
    exportRows: jest.fn(async () => [withdrawal()]),
  };
  const withdrawals = {
    payableByHand: jest.fn(() => [AccountTransactionStatus.Failed]),
    findById: jest.fn(async () => withdrawal()),
    verifyPayment: jest.fn(),
    completeManually: jest.fn(async () =>
      withdrawal({
        status: AccountTransactionStatus.Completed,
        statusReason: null,
        paidManually: true,
        actorUserId: admin.id,
        txHash: HASH,
      }),
    ),
    reject: jest.fn(async () =>
      withdrawal({
        status: AccountTransactionStatus.Canceled,
        statusReason: AccountTransactionStatusReason.RejectedByAdmin,
        comment: 'Suspicious',
        actorUserId: admin.id,
      }),
    ),
  };
  const directory = {
    findIdsMatching: jest.fn(async () => [TRADER]),
    rankByLogin: jest.fn(async () => new Map()),
    findByIds: jest.fn(async () => [
      { id: TRADER, telegramUsername: 'durov' } as User,
      { id: admin.id, telegramUsername: 'admin' } as User,
    ]),
    findById: jest.fn(async () => ({ id: TRADER, role: Role.Trader }) as User),
  };
  const controller = new AdminWithdrawalsController(
    config as never,
    operations as never,
    withdrawals as never,
    directory as never,
  );

  return { controller, operations, withdrawals, directory };
};

describe('AdminWithdrawalsController', () => {
  it('is for admin and superadmin, and writes only on complete-manually and reject', () => {
    expect(
      Reflect.getMetadata(ROLES_METADATA_KEY, AdminWithdrawalsController),
    ).toEqual([Role.Admin, Role.Superadmin]);

    const marked = (handler: keyof AdminWithdrawalsController) =>
      Reflect.getMetadata(
        WRITE_ACCESS_METADATA_KEY,
        AdminWithdrawalsController.prototype[handler],
      ) === true;

    expect(marked('completeManually')).toBe(true);
    expect(marked('reject')).toBe(true);
    expect(marked('verify')).toBe(false);
    expect(marked('list')).toBe(false);
    expect(marked('stats')).toBe(false);
    expect(marked('export')).toBe(false);
  });

  it('lists withdrawals with one users lookup and one attempts lookup', async () => {
    const { controller, operations, directory } = build();

    const page = await controller.list(query());

    expect(operations.list).toHaveBeenCalledWith(
      expect.objectContaining({ type: AccountTransactionType.Withdrawal }),
    );
    expect(operations.attemptsOf).toHaveBeenCalledTimes(1);
    expect(directory.findByIds).toHaveBeenCalledTimes(1);
    expect(page.items[0]).toMatchObject({
      id: 41,
      user: { id: TRADER, login: 'durov' },
      attempts: [{ txHash: HASH, status: OutgoingTransferStatus.Failed }],
      amount: '100.000000',
      fee: '0.250000',
      actions: { canPayManually: true, canReject: true },
    });
  });

  describe('stats', () => {
    const stats = {
      byStatus: {
        pending: 4,
        processing: 2,
        completed: 18,
        failed: 1,
        canceled: 24,
      },
      belowMinimum: 0,
      completedLast24h: { count: 18, amount: toCrypto('1200.5') },
      finishedLast24h: 43,
      staleProcessing: 1,
    };

    it('maps the counts to the KPI cards with the mode from the environment', async () => {
      const { controller, operations } = build('manual');
      operations.stats.mockResolvedValue(stats);

      await expect(controller.stats()).resolves.toEqual({
        queued: 4,
        active: 2,
        stale: 1,
        manualReview: 0,
        failed: 1,
        paidLast24h: { count: 18, amount: '1200.500000' },
        successRate: 42,
        mode: 'manual',
        byStatus: stats.byStatus,
      });
    });

    it('answers a success rate of zero when nothing finished', async () => {
      const { controller, operations } = build();
      operations.stats.mockResolvedValue({ ...stats, finishedLast24h: 0 });

      expect((await controller.stats()).successRate).toBe(0);
    });
  });

  describe('export', () => {
    it('answers a CSV file with amount and fee', async () => {
      const { controller } = build();

      const file = await controller.export(query());

      expect(file).toBeInstanceOf(StreamableFile);
      const csv = (file.getStream().read() as Buffer).toString('utf-8');
      expect(csv.split('\r\n')[1]).toBe(
        `41,failed,network_failed,durov,${EXTERNAL},100.000000,0.250000,,2026-10-25T10:00:00.000Z,`,
      );
    });

    it('400 over the cap', async () => {
      const { controller, operations } = build();
      operations.exportRows.mockResolvedValue(
        new Array(ACCOUNT_TRANSACTIONS_EXPORT_MAX_ROWS + 1).fill(withdrawal()),
      );

      await expect(controller.export(query())).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  it('maps a payment verification', async () => {
    const { controller, withdrawals } = build();
    withdrawals.verifyPayment.mockResolvedValue({
      inspection: { status: 'pending', transfers: [] },
      completable: false,
      amountSent: null,
      reason: 'The transaction is not confirmed yet',
    });

    await expect(controller.verify(41, { txHash: HASH })).resolves.toEqual({
      status: 'pending',
      transfers: [],
      acceptable: false,
      amount: null,
      reason: 'The transaction is not confirmed yet',
    });
    expect(withdrawals.verifyPayment).toHaveBeenCalledWith(41, HASH);
  });

  describe.each(['completeManually', 'reject'] as const)('%s', (handler) => {
    const call = (controller: AdminWithdrawalsController) =>
      handler === 'completeManually'
        ? controller.completeManually(41, { txHash: HASH }, admin)
        : controller.reject(41, { reason: 'Suspicious' }, admin);

    it('404 for an unknown withdrawal', async () => {
      const { controller, withdrawals } = build();
      withdrawals.findById.mockResolvedValue(null as never);

      await expect(call(controller)).rejects.toBeInstanceOf(NotFoundException);
      expect(withdrawals[handler]).not.toHaveBeenCalled();
    });

    it('403 on the admin’s own account', async () => {
      const { controller, directory } = build();
      directory.findById.mockResolvedValue({
        id: admin.id,
        role: Role.Admin,
      } as User);

      await expect(call(controller)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('403 when an admin acts on a superadmin', async () => {
      const { controller, directory, withdrawals } = build();
      directory.findById.mockResolvedValue({
        id: TRADER,
        role: Role.Superadmin,
      } as User);

      await expect(call(controller)).rejects.toBeInstanceOf(ForbiddenException);
      expect(withdrawals[handler]).not.toHaveBeenCalled();
    });
  });

  it('closes a withdrawal by hand as the acting admin', async () => {
    const { controller, withdrawals } = build();

    const answer = await controller.completeManually(
      41,
      { txHash: HASH },
      admin,
    );

    expect(withdrawals.completeManually).toHaveBeenCalledWith(
      41,
      HASH,
      admin.id,
    );
    expect(answer).toMatchObject({
      status: AccountTransactionStatus.Completed,
      paidManually: true,
      actor: { id: admin.id, login: 'admin' },
      actions: { canPayManually: false, canReject: false },
    });
  });

  it('rejects as the acting admin with the reason', async () => {
    const { controller, withdrawals } = build();

    const answer = await controller.reject(41, { reason: 'Suspicious' }, admin);

    expect(withdrawals.reject).toHaveBeenCalledWith(41, admin.id, 'Suspicious');
    expect(answer).toMatchObject({
      status: AccountTransactionStatus.Canceled,
      comment: 'Suspicious',
    });
  });
});
