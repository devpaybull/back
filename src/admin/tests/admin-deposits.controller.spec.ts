import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { AccountTransaction } from '../../account-transactions/entities/account-transaction.entity';
import { AccountTransactionSortField } from '../../account-transactions/types/account-transaction-sort-field.enum';
import { AccountTransactionStatus } from '../../account-transactions/types/account-transaction-status.enum';
import { AccountTransactionType } from '../../account-transactions/types/account-transaction-type.enum';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { toPage } from '../../common/types/page';
import { AuthenticatedUser } from '../../common/types/token';
import { toCrypto } from '../../common/utils/to-crypto';
import { User } from '../../users/entities/user.entity';
import { UserStatus } from '../../users/types/user-status.enum';
import { AdminDepositsController } from '../controllers/admin-deposits.controller';
import { ListAccountTransactionsQueryDto } from '../dto/list-account-transactions-query.dto';
import { ACCOUNT_TRANSACTIONS_EXPORT_MAX_ROWS } from '../utils/account-transactions-export-max-rows';

const TRADER = uuidOf(1);
const HASH = 'a'.repeat(64);
const admin: AuthenticatedUser = {
  id: uuidOf(9),
  login: 'admin',
  role: Role.Admin,
  status: UserStatus.Active,
};

const deposit = (
  overrides: Partial<AccountTransaction> = {},
): AccountTransaction =>
  ({
    id: 41,
    type: AccountTransactionType.Deposit,
    status: AccountTransactionStatus.Failed,
    statusReason: null,
    userId: TRADER,
    amount: toCrypto(500),
    amountReceived: null,
    creditedAmount: null,
    address: 'TDepositAddressxxxxxxxxxxxxxxxxxxx',
    expiresAt: null,
    txHash: null,
    actorUserId: null,
    createdAt: new Date('2026-10-25T10:00:00Z'),
    completedAt: null,
    ...overrides,
  }) as AccountTransaction;

const query = (
  overrides: Partial<ListAccountTransactionsQueryDto> = {},
): ListAccountTransactionsQueryDto =>
  Object.assign(new ListAccountTransactionsQueryDto(), {
    page: 1,
    limit: 20,
    ...overrides,
  });

const build = () => {
  const config = {
    get: jest.fn((_key: string, fallback?: unknown) => fallback),
    getOrThrow: jest.fn(() => 45),
  };
  const operations = {
    list: jest.fn(async () => toPage([[deposit()], 1], { page: 1, limit: 20 })),
    userIdsOf: jest.fn(async () => [TRADER]),
    transfersOf: jest.fn(
      async () =>
        new Map([
          [
            41,
            [
              {
                txHash: HASH,
                amount: toCrypto(500),
                fromAddress: 'TFrom',
              },
            ],
          ],
        ]),
    ),
    stats: jest.fn(),
    exportRows: jest.fn(async () => [deposit()]),
  };
  const deposits = {
    findById: jest.fn(async () => deposit()),
    verifyForCredit: jest.fn(),
    planCreditByHash: jest.fn(),
    creditByHash: jest.fn(async () => [
      deposit({
        status: AccountTransactionStatus.Completed,
        actorUserId: admin.id,
      }),
    ]),
    creditManually: jest.fn(async () =>
      deposit({
        status: AccountTransactionStatus.Completed,
        actorUserId: admin.id,
      }),
    ),
  };
  const directory = {
    findIdsMatching: jest.fn(async () => [TRADER]),
    rankByLogin: jest.fn(async () => new Map([[TRADER, 0]])),
    findByIds: jest.fn(async () => [
      { id: TRADER, telegramUsername: 'durov', email: null } as User,
    ]),
    findById: jest.fn(async () => ({ id: TRADER, role: Role.Trader }) as User),
  };
  const controller = new AdminDepositsController(
    config as never,
    operations as never,
    deposits as never,
    directory as never,
  );

  return { controller, config, operations, deposits, directory };
};

describe('AdminDepositsController', () => {
  it('is for admin and superadmin, and writes only on credit', () => {
    expect(
      Reflect.getMetadata(ROLES_METADATA_KEY, AdminDepositsController),
    ).toEqual([Role.Admin, Role.Superadmin]);

    const marked = (handler: keyof AdminDepositsController) =>
      Reflect.getMetadata(
        WRITE_ACCESS_METADATA_KEY,
        AdminDepositsController.prototype[handler],
      ) === true;

    expect(marked('credit')).toBe(true);
    expect(marked('verify')).toBe(false);
    expect(marked('list')).toBe(false);
    expect(marked('stats')).toBe(false);
    expect(marked('export')).toBe(false);
  });

  describe('list', () => {
    it('composes the page with one users lookup and one transfers lookup', async () => {
      const { controller, operations, directory } = build();

      const page = await controller.list(query());

      expect(operations.list).toHaveBeenCalledWith(
        expect.objectContaining({ type: AccountTransactionType.Deposit }),
      );
      expect(operations.transfersOf).toHaveBeenCalledTimes(1);
      expect(operations.transfersOf).toHaveBeenCalledWith([41]);
      expect(directory.findByIds).toHaveBeenCalledTimes(1);
      expect(page.items[0]).toMatchObject({
        id: 41,
        user: { id: TRADER, login: 'durov', telegramUsername: 'durov' },
        windowMinutes: 45,
        transfers: [
          { txHash: HASH, amount: '500.000000', fromAddress: 'TFrom' },
        ],
        aml: null,
        actions: { canCredit: true },
      });
    });

    it('searches logins through the users module, not for an all-digits term', async () => {
      const { controller, operations, directory } = build();

      await controller.list(query({ search: 'durov' }));
      await controller.list(query({ search: '41' }));

      expect(directory.findIdsMatching).toHaveBeenCalledTimes(1);
      expect(directory.findIdsMatching).toHaveBeenCalledWith('durov');
      expect(operations.list).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ search: 'durov', matchedUserIds: [TRADER] }),
      );
      expect(operations.list).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ search: '41', matchedUserIds: undefined }),
      );
    });

    it('ranks the matching accounts by login for sortBy=user', async () => {
      const { controller, operations, directory } = build();

      await controller.list(
        query({ sortBy: AccountTransactionSortField.User }),
      );

      expect(operations.userIdsOf).toHaveBeenCalled();
      expect(directory.rankByLogin).toHaveBeenCalledWith([TRADER]);
      expect(operations.list).toHaveBeenCalledWith(
        expect.objectContaining({ userRanks: new Map([[TRADER, 0]]) }),
      );
    });
  });

  describe('stats', () => {
    it('maps the grouped counts to the KPI cards', async () => {
      const { controller, operations } = build();
      operations.stats.mockResolvedValue({
        byStatus: {
          pending: 3,
          processing: 2,
          completed: 25,
          failed: 1,
          canceled: 4,
        },
        belowMinimum: 1,
        completedLast24h: { count: 25, amount: toCrypto('90500.5') },
        finishedLast24h: 30,
        staleProcessing: 0,
      });

      await expect(controller.stats()).resolves.toEqual({
        total: 35,
        inProgress: 5,
        processing: 2,
        belowMinimum: 1,
        problem: 1,
        completedLast24h: { count: 25, amount: '90500.500000' },
        successRate: 83,
        byStatus: {
          pending: 3,
          processing: 2,
          completed: 25,
          failed: 1,
          canceled: 4,
        },
      });
    });

    it('answers a success rate of zero when nothing finished', async () => {
      const { controller, operations } = build();
      operations.stats.mockResolvedValue({
        byStatus: {
          pending: 0,
          processing: 0,
          completed: 0,
          failed: 0,
          canceled: 0,
        },
        belowMinimum: 0,
        completedLast24h: { count: 0, amount: toCrypto(0) },
        finishedLast24h: 0,
        staleProcessing: 0,
      });

      expect((await controller.stats()).successRate).toBe(0);
    });
  });

  describe('export', () => {
    it('answers a CSV file with the credited amount and the login', async () => {
      const { controller, operations } = build();
      operations.exportRows.mockResolvedValue([
        deposit({
          status: AccountTransactionStatus.Completed,
          creditedAmount: toCrypto('499.5'),
          txHash: HASH,
          completedAt: new Date('2026-10-25T10:05:00Z'),
        }),
      ]);

      const file = await controller.export(query());

      expect(file).toBeInstanceOf(StreamableFile);
      expect(operations.exportRows).toHaveBeenCalledWith(
        expect.objectContaining({ type: AccountTransactionType.Deposit }),
        ACCOUNT_TRANSACTIONS_EXPORT_MAX_ROWS,
      );
      const csv = (file.getStream().read() as Buffer).toString('utf-8');
      expect(csv.split('\r\n')[0]).toBe(
        'id,status,statusReason,user,address,amount,fee,txHash,createdAt,completedAt',
      );
      expect(csv.split('\r\n')[1]).toBe(
        `41,completed,,durov,TDepositAddressxxxxxxxxxxxxxxxxxxx,499.500000,,${HASH},2026-10-25T10:00:00.000Z,2026-10-25T10:05:00.000Z`,
      );
    });

    it('falls back to the requested amount and to empty for none', async () => {
      const { controller, operations } = build();
      operations.exportRows.mockResolvedValue([deposit({ amount: null })]);

      const csv = (
        (await controller.export(query())).getStream().read() as Buffer
      ).toString('utf-8');

      expect(csv.split('\r\n')[1]).toContain(',,,,');
    });

    it('400 over the cap', async () => {
      const { controller, operations } = build();
      operations.exportRows.mockResolvedValue(
        new Array(ACCOUNT_TRANSACTIONS_EXPORT_MAX_ROWS + 1).fill(deposit()),
      );

      await expect(controller.export(query())).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  it('maps a verification to the modal’s answer', async () => {
    const { controller, deposits } = build();
    deposits.verifyForCredit.mockResolvedValue({
      inspection: {
        status: 'confirmed',
        transfers: [
          {
            txHash: HASH,
            logIndex: 0,
            from: 'TFrom',
            to: 'TTo',
            amount: toCrypto(500),
            blockNumber: 7,
            blockTime: new Date(0),
          },
        ],
      },
      creditable: true,
      amount: '500.000000',
      reason: null,
    });

    const answer = await controller.verify(41, { txHash: HASH });

    expect(deposits.verifyForCredit).toHaveBeenCalledWith(41, HASH);
    expect(answer).toEqual({
      status: 'confirmed',
      transfers: [
        expect.objectContaining({ amount: '500.000000', logIndex: 0 }),
      ],
      acceptable: true,
      amount: '500.000000',
      reason: null,
    });
  });

  describe('credit', () => {
    it('404 for an unknown deposit', async () => {
      const { controller, deposits } = build();
      deposits.findById.mockResolvedValue(null as never);

      await expect(
        controller.credit(41, { txHash: HASH }, admin),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(deposits.creditManually).not.toHaveBeenCalled();
    });

    it('403 on the admin’s own account', async () => {
      const { controller, deposits, directory } = build();
      deposits.findById.mockResolvedValue(deposit({ userId: admin.id }));
      directory.findById.mockResolvedValue({
        id: admin.id,
        role: Role.Admin,
      } as User);

      await expect(
        controller.credit(41, { txHash: HASH }, admin),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('403 when an admin acts on another admin', async () => {
      const { controller, directory, deposits } = build();
      directory.findById.mockResolvedValue({
        id: TRADER,
        role: Role.Admin,
      } as User);

      await expect(
        controller.credit(41, { txHash: HASH }, admin),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(deposits.creditManually).not.toHaveBeenCalled();
    });

    it('credits as the acting admin and answers the row', async () => {
      const { controller, deposits } = build();

      const answer = await controller.credit(41, { txHash: HASH }, admin);

      expect(deposits.creditManually).toHaveBeenCalledWith(41, HASH, admin.id);
      expect(answer).toMatchObject({
        status: AccountTransactionStatus.Completed,
        actions: { canCredit: false },
      });
    });
  });

  describe('crediting by hash', () => {
    const plan = (refusal: Error | null = null, userId = TRADER) => ({
      inspection: {
        status: 'confirmed' as const,
        transfers: [
          {
            txHash: HASH,
            logIndex: 0,
            from: 'TFrom',
            to: 'TDepositAddressxxxxxxxxxxxxxxxxxxx',
            amount: toCrypto('12.5'),
            blockNumber: 9,
            blockTime: new Date('2026-10-25T11:00:00Z'),
          },
        ],
      },
      candidates: [
        {
          userId,
          address: 'TDepositAddressxxxxxxxxxxxxxxxxxxx',
          addressId: 7,
          transfers: [
            {
              txHash: HASH,
              logIndex: 0,
              from: 'TFrom',
              to: 'TDepositAddressxxxxxxxxxxxxxxxxxxx',
              amount: toCrypto('12.5'),
              blockNumber: 9,
              blockTime: new Date('2026-10-25T11:00:00Z'),
            },
          ],
          alreadyCredited: false,
        },
      ],
      refusal,
    });

    it('marks credit-by-hash as a write and verify-by-hash as a read', () => {
      expect(
        Reflect.getMetadata(
          WRITE_ACCESS_METADATA_KEY,
          AdminDepositsController.prototype.creditByHash,
        ),
      ).toBe(true);
      expect(
        Reflect.getMetadata(
          WRITE_ACCESS_METADATA_KEY,
          AdminDepositsController.prototype.verifyByHash,
        ),
      ).toBeUndefined();
    });

    it('maps the plan of verify-by-hash with the owner and the formatted sum', async () => {
      const { controller, deposits } = build();
      deposits.planCreditByHash.mockResolvedValue(plan());

      const result = await controller.verifyByHash({ txHash: HASH });

      expect(result).toMatchObject({
        status: 'confirmed',
        acceptable: true,
        reason: null,
        candidates: [
          {
            user: { id: TRADER, login: 'durov' },
            amount: '12.500000',
            alreadyCredited: false,
          },
        ],
      });
      expect(result.transfers[0].amount).toBe('12.500000');
    });

    it('reports the refusal in verify-by-hash without throwing', async () => {
      const { controller, deposits } = build();
      deposits.planCreditByHash.mockResolvedValue(
        plan(new BadRequestException('nobody')),
      );

      const result = await controller.verifyByHash({ txHash: HASH });

      expect(result).toMatchObject({ acceptable: false, reason: 'nobody' });
    });

    it('throws the refusal of the plan before checking anyone', async () => {
      const { controller, deposits, directory } = build();
      deposits.planCreditByHash.mockResolvedValue(
        plan(new BadRequestException('nobody')),
      );

      await expect(
        controller.creditByHash({ txHash: HASH }, admin),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(directory.findByIds).not.toHaveBeenCalled();
      expect(deposits.creditByHash).not.toHaveBeenCalled();
    });

    it('403 when the transfer went to the admin’s own address', async () => {
      const { controller, deposits, directory } = build();
      deposits.planCreditByHash.mockResolvedValue(plan(null, admin.id));
      directory.findByIds.mockResolvedValue([
        { id: admin.id, role: Role.Trader } as User,
      ]);

      await expect(
        controller.creditByHash({ txHash: HASH }, admin),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(deposits.creditByHash).not.toHaveBeenCalled();
    });

    it('403 when an owner is beyond the admin’s reach', async () => {
      const { controller, deposits, directory } = build();
      deposits.planCreditByHash.mockResolvedValue(plan());
      directory.findByIds.mockResolvedValue([
        { id: TRADER, role: Role.Admin } as User,
      ]);

      await expect(
        controller.creditByHash({ txHash: HASH }, admin),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(deposits.creditByHash).not.toHaveBeenCalled();
    });

    it('credits with the acting admin and answers the credited rows', async () => {
      const { controller, deposits, directory } = build();
      deposits.planCreditByHash.mockResolvedValue(plan());
      directory.findByIds.mockResolvedValue([
        { id: TRADER, role: Role.Trader, telegramUsername: 'durov' } as User,
      ]);

      const rows = await controller.creditByHash({ txHash: HASH }, admin);

      expect(deposits.creditByHash).toHaveBeenCalledWith(HASH, admin.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        status: AccountTransactionStatus.Completed,
      });
    });
  });
});
