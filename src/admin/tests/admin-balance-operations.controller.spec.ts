import { TransfersService } from '../../account-transactions/services/transfers.service';
import {
  BadRequestException,
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { toCrypto } from '../../common/utils/to-crypto';
import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WriteAccessGuard } from '../../common/guards/write-access.guard';
import { ResponseEnvelopeInterceptor } from '../../common/interceptors/response-envelope.interceptor';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { toPage } from '../../common/types/page';
import { DebtsService } from '../../debts/services/debts.service';
import { BalanceOperation } from '../../transactions/entities/balance-operation.entity';
import { WalletService } from '../../transactions/services/wallet.service';
import { BalanceKind } from '../../transactions/types/balance-kind.enum';
import { BalanceOperationType } from '../../transactions/types/balance-operation-type.enum';
import { UserDirectoryService } from '../../users/services/user-directory.service';
import {
  AdminBalancesController,
  BALANCE_EXPORT_MAX_ROWS,
} from '../controllers/admin-balances.controller';

const USER = uuidOf(1);

const operation = (
  id: number,
  overrides: Partial<BalanceOperation> = {},
): BalanceOperation =>
  ({
    id,
    createdAt: new Date(`2026-10-2${id}T10:00:00.000Z`),
    type: BalanceOperationType.Transaction,
    balanceKind: BalanceKind.Main,
    transactionId: null,
    accountTransactionId: null,
    amount: toCrypto(10),
    balanceBefore: toCrypto(0),
    balanceAfter: toCrypto(10),
    ...overrides,
  }) as BalanceOperation;

describe('AdminBalancesController balance journal', () => {
  let wallets: { listOperations: jest.Mock; exportOperations: jest.Mock };
  let directory: { findById: jest.Mock };
  let debts: { debtIdsByBalanceOperation: jest.Mock };
  let controller: AdminBalancesController;

  beforeEach(() => {
    wallets = { listOperations: jest.fn(), exportOperations: jest.fn() };
    directory = { findById: jest.fn(async () => ({ id: USER })) };
    debts = { debtIdsByBalanceOperation: jest.fn(async () => new Map()) };
    controller = new AdminBalancesController(
      wallets as never,
      {} as never,
      directory as never,
      debts as never,
    );
  });

  it('is read-only: neither handler is a write', () => {
    expect(
      Reflect.getMetadata(
        WRITE_ACCESS_METADATA_KEY,
        controller.balanceOperations,
      ),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(
        WRITE_ACCESS_METADATA_KEY,
        controller.exportBalanceOperations,
      ),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(ROLES_METADATA_KEY, AdminBalancesController),
    ).toEqual([Role.Admin, Role.Superadmin]);
  });

  it('404 for an unknown user on both endpoints, before any journal read', async () => {
    directory.findById.mockResolvedValue(null);

    await expect(
      controller.balanceOperations(USER, { page: 1, limit: 20 } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      controller.exportBalanceOperations(USER, {}),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(wallets.listOperations).not.toHaveBeenCalled();
    expect(wallets.exportOperations).not.toHaveBeenCalled();
  });

  it('passes the filters on and maps rows with deal, debt and account transaction references', async () => {
    const from = new Date('2026-10-01T00:00:00Z');
    wallets.listOperations.mockResolvedValue(
      toPage(
        [
          [
            operation(1, { transactionId: uuidOf(50) }),
            operation(2, { type: BalanceOperationType.DebtIssued }),
            operation(3, { type: BalanceOperationType.AdminAdjustment }),
            operation(4, {
              type: BalanceOperationType.Internal,
              accountTransactionId: 41,
            }),
          ],
          4,
        ],
        { page: 1, limit: 20 },
      ),
    );
    debts.debtIdsByBalanceOperation.mockResolvedValue(new Map([[2, 9]]));

    const page = await controller.balanceOperations(USER, {
      page: 1,
      limit: 20,
      sortOrder: 'desc',
      from,
      type: [BalanceOperationType.Transaction],
      kind: BalanceKind.Main,
    } as never);

    expect(wallets.listOperations).toHaveBeenCalledWith({
      userId: USER,
      from,
      to: undefined,
      types: [BalanceOperationType.Transaction],
      kind: BalanceKind.Main,
      page: 1,
      limit: 20,
      sortOrder: 'desc',
    });
    expect(page.items.map((row) => row.reference)).toEqual([
      { transactionId: uuidOf(50), debtId: null, accountTransactionId: null },
      { transactionId: null, debtId: 9, accountTransactionId: null },
      null,
      { transactionId: null, debtId: null, accountTransactionId: 41 },
    ]);
    expect(page.items[0]).toMatchObject({
      id: 1,
      kind: BalanceKind.Main,
      amount: '10.000000',
      balanceBefore: '0.000000',
      balanceAfter: '10.000000',
    });
    expect(page.meta.total).toBe(4);
  });

  it('resolves debts in one batched lookup over the debt rows only', async () => {
    wallets.listOperations.mockResolvedValue(
      toPage(
        [
          [
            operation(1),
            operation(2, { type: BalanceOperationType.DebtIssued }),
            operation(3, { type: BalanceOperationType.DebtWriteOff }),
          ],
          3,
        ],
        { page: 1, limit: 20 },
      ),
    );

    await controller.balanceOperations(USER, { page: 1, limit: 20 } as never);

    expect(debts.debtIdsByBalanceOperation).toHaveBeenCalledTimes(1);
    expect(debts.debtIdsByBalanceOperation).toHaveBeenCalledWith([2, 3]);
  });

  it('exports with the cap and without paging', async () => {
    wallets.exportOperations.mockResolvedValue([operation(1)]);

    await controller.exportBalanceOperations(USER, {
      kind: BalanceKind.Main,
    });

    expect(BALANCE_EXPORT_MAX_ROWS).toBe(100000);
    expect(wallets.exportOperations).toHaveBeenCalledWith(
      {
        userId: USER,
        from: undefined,
        to: undefined,
        types: undefined,
        kind: BalanceKind.Main,
      },
      100000,
    );
  });
});

describe('balance journal over HTTP', () => {
  let app: INestApplication;
  let wallets: { listOperations: jest.Mock; exportOperations: jest.Mock };

  beforeEach(async () => {
    wallets = { listOperations: jest.fn(), exportOperations: jest.fn() };
    const allow = { canActivate: () => true };
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminBalancesController],
      providers: [
        { provide: WalletService, useValue: wallets },
        { provide: TransfersService, useValue: {} },
        {
          provide: UserDirectoryService,
          useValue: { findById: jest.fn(async () => ({ id: USER })) },
        },
        {
          provide: DebtsService,
          useValue: {
            debtIdsByBalanceOperation: jest.fn(async () => new Map([[2, 9]])),
          },
        },
      ],
    })
      .overrideGuard(RolesGuard)
      .useValue(allow)
      .overrideGuard(WriteAccessGuard)
      .useValue(allow)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    await app.init();
  });

  afterEach(() => app.close());

  it('wraps the list in the paged envelope', async () => {
    wallets.listOperations.mockResolvedValue(
      toPage([[operation(1)], 1], { page: 1, limit: 20 }),
    );

    const response = await request(app.getHttpServer())
      .get(`/admin/users/${USER}/balance-operations?type=transaction,internal`)
      .expect(200);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.meta).toEqual({
      total: 1,
      page: 1,
      limit: 20,
      pages: 1,
    });
    expect(wallets.listOperations).toHaveBeenCalledWith(
      expect.objectContaining({
        types: [
          BalanceOperationType.Transaction,
          BalanceOperationType.Internal,
        ],
      }),
    );
  });

  it('answers 400 for a limit over 100', async () => {
    await request(app.getHttpServer())
      .get(`/admin/users/${USER}/balance-operations?limit=101`)
      .expect(400);
  });

  it('serves the CSV as an attachment, not inside the envelope', async () => {
    wallets.exportOperations.mockResolvedValue([
      operation(1, { transactionId: uuidOf(50) }),
      operation(2, { type: BalanceOperationType.DebtIssued }),
    ]);

    const response = await request(app.getHttpServer())
      .get(`/admin/users/${USER}/balance-operations/export`)
      .expect(200);

    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="balance-operations-${USER}.csv"`,
    );
    expect(response.text).toBe(
      'date,type,kind,amount,balanceBefore,balanceAfter,reference\r\n' +
        `2026-10-21T10:00:00.000Z,transaction,main,10.000000,0.000000,10.000000,transaction:${uuidOf(50)}\r\n` +
        '2026-10-22T10:00:00.000Z,debt_issued,main,10.000000,0.000000,10.000000,debt:9\r\n',
    );
  });

  it('answers 400 when the export is over the cap', async () => {
    wallets.exportOperations.mockRejectedValue(
      new BadRequestException('narrow the period'),
    );

    await request(app.getHttpServer())
      .get(`/admin/users/${USER}/balance-operations/export`)
      .expect(400);
  });
});
