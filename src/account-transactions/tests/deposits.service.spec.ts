import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { LessThanOrEqual, MoreThan } from 'typeorm';
import { ActivityAction } from '../../audit/types/activity-action.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { toCrypto } from '../../common/utils/to-crypto';
import { TronAddress } from '../../tron/entities/tron-address.entity';
import { AddressPurpose } from '../../tron/types/address-purpose.enum';
import { UsdtTransferEvent } from '../../tron/types/usdt-transfer-event';
import { UsdtTransferInspection } from '../../tron/types/usdt-transfer-inspection';
import { AccountTransaction } from '../entities/account-transaction.entity';
import { DepositAddress } from '../entities/deposit-address.entity';
import { DepositTransfer } from '../entities/deposit-transfer.entity';
import { DepositsService } from '../services/deposits.service';
import { AccountTransactionStatus } from '../types/account-transaction-status.enum';
import { AccountTransactionStatusReason } from '../types/account-transaction-status-reason.enum';
import { AccountTransactionType } from '../types/account-transaction-type.enum';

const TRADER = uuidOf(1);
const ADMIN = uuidOf(9);
const ADDRESS = 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf';
const OTHER = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const NOW = new Date('2026-10-25T12:00:00.000Z');
const HASH = 'a'.repeat(64);

const ENV: Record<string, unknown> = {
  DEPOSIT_MIN_USDT: '10',
  DEPOSIT_MAX_ACTIVE_REQUESTS: 3,
  DEPOSIT_WINDOW_MINUTES: 45,
};

const owner = (): DepositAddress =>
  ({
    id: 1,
    userId: TRADER,
    tronAddressId: 7,
    address: ADDRESS,
  }) as DepositAddress;

const tronAddress = { id: 7, address: ADDRESS } as TronAddress;

const event = (
  overrides: Partial<UsdtTransferEvent> = {},
): UsdtTransferEvent => ({
  txHash: HASH,
  logIndex: 0,
  from: OTHER,
  to: ADDRESS,
  amount: toCrypto(100),
  blockNumber: 500,
  blockTime: NOW,
  ...overrides,
});

const deposit = (
  overrides: Partial<AccountTransaction> = {},
): AccountTransaction =>
  ({
    id: 40,
    type: AccountTransactionType.Deposit,
    status: AccountTransactionStatus.Pending,
    statusReason: null,
    userId: TRADER,
    amount: toCrypto(100),
    amountReceived: null,
    creditedAmount: null,
    address: ADDRESS,
    addressId: 7,
    txHash: null,
    actorUserId: null,
    expiresAt: new Date(NOW.getTime() + 60_000),
    completedAt: null,
    createdAt: NOW,
    ...overrides,
  }) as AccountTransaction;

const build = () => {
  let nextId = 100;
  const lockedBuilder = {
    setLock: jest.fn(),
    setOnLocked: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    getOne: jest.fn(async (): Promise<AccountTransaction | null> => null),
  };
  lockedBuilder.setLock.mockReturnValue(lockedBuilder);
  lockedBuilder.setOnLocked.mockReturnValue(lockedBuilder);
  lockedBuilder.where.mockReturnValue(lockedBuilder);
  lockedBuilder.andWhere.mockReturnValue(lockedBuilder);
  const manager = {
    query: jest.fn(async () => undefined),
    findOne: jest.fn<Promise<unknown>, [unknown?, unknown?]>(async () => null),
    find: jest.fn<Promise<unknown[]>, [unknown?, unknown?]>(async () => []),
    count: jest.fn<Promise<number>, [unknown?, unknown?]>(async () => 0),
    create: jest.fn((_entity: unknown, data: object) => ({ ...data })),
    save: jest.fn(async (row: { id?: number }) =>
      Object.assign(row, { id: row.id ?? nextId++ }),
    ),
    getRepository: jest.fn(() => ({
      createQueryBuilder: jest.fn(() => lockedBuilder),
    })),
  };
  const repositories = {
    address: {
      findOne: jest.fn(async (): Promise<unknown> => null),
      find: jest.fn(async (): Promise<unknown[]> => []),
    },
    transfers: { count: jest.fn(async (): Promise<number> => 0) },
    transactions: {
      findOne: jest.fn(async (): Promise<unknown> => null),
      find: jest.fn(async (): Promise<unknown[]> => []),
    },
  };
  const dataSource = {
    getRepository: jest.fn((entity: unknown) =>
      entity === DepositAddress
        ? repositories.address
        : entity === DepositTransfer
          ? repositories.transfers
          : repositories.transactions,
    ),
    transaction: jest.fn(
      async (work: (entityManager: typeof manager) => unknown) => work(manager),
    ),
    manager,
  };
  const config = {
    get: jest.fn((key: string) => ENV[key]),
    getOrThrow: jest.fn((key: string) => ENV[key]),
  };
  const wallets = { creditDepositWithin: jest.fn(async () => undefined) };
  const audit = { record: jest.fn(async () => undefined) };
  const keyring = {
    issueDepositAddress: jest.fn(async () => tronAddress),
  };
  const scanner = { register: jest.fn() };
  const verifier = {
    inspectUsdtTransfer: jest.fn(async (): Promise<UsdtTransferInspection> => ({
      status: 'confirmed',
      transfers: [event()],
    })),
  };
  const service = new DepositsService(
    config as never,
    wallets as never,
    audit as never,
    keyring as never,
    scanner as never,
    verifier as never,
    dataSource as never,
  );

  return {
    service,
    manager,
    lockedBuilder,
    repositories,
    dataSource,
    wallets,
    audit,
    keyring,
    scanner,
    verifier,
  };
};

const byEntity =
  (answers: Map<unknown, unknown>) =>
  async (entity: unknown): Promise<unknown> =>
    answers.get(entity) ?? null;

describe('DepositsService', () => {
  describe('onModuleInit', () => {
    it('registers the deposit handler with the scanner', () => {
      const { service, scanner } = build();

      service.onModuleInit();

      expect(scanner.register).toHaveBeenCalledWith(
        AddressPurpose.Deposit,
        expect.any(Function),
      );
    });
  });

  describe('deposit addresses', () => {
    it('reads an existing address without opening a transaction', async () => {
      const { service, repositories, dataSource } = build();
      repositories.address.findOne.mockResolvedValue(owner());

      await expect(service.depositAddressOf(TRADER)).resolves.toEqual(owner());
      await expect(service.existingDepositAddressOf(TRADER)).resolves.toEqual(
        owner(),
      );
      expect(repositories.address.findOne).toHaveBeenCalledWith({
        where: { userId: TRADER },
      });
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('answers null when the trader has none yet', async () => {
      const { service } = build();

      await expect(
        service.existingDepositAddressOf(TRADER),
      ).resolves.toBeNull();
    });

    it('issues one under the per-user lock and stores it', async () => {
      const { service, manager, keyring } = build();

      const issued = await service.depositAddressOf(TRADER);

      expect(manager.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        [`deposit_addresses:${TRADER}`],
      );
      expect(keyring.issueDepositAddress).toHaveBeenCalledWith(manager);
      expect(manager.create).toHaveBeenCalledWith(DepositAddress, {
        userId: TRADER,
        tronAddressId: 7,
        address: ADDRESS,
      });
      expect(issued.address).toBe(ADDRESS);
      expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(
        keyring.issueDepositAddress.mock.invocationCallOrder[0],
      );
    });

    it('returns the row a concurrent request stored first, issuing nothing', async () => {
      const { service, manager, keyring } = build();
      manager.findOne.mockResolvedValue(owner());

      await expect(service.depositAddressOf(TRADER)).resolves.toEqual(owner());
      expect(keyring.issueDepositAddress).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
    });
  });

  describe('createRequest', () => {
    it('refuses an amount below the minimum before anything is written', async () => {
      const { service, dataSource, repositories } = build();
      repositories.address.findOne.mockResolvedValue(owner());

      await expect(
        service.createRequest(TRADER, toCrypto('9.999999'), NOW),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('refuses when the trader already holds the maximum of live requests', async () => {
      const { service, manager, repositories } = build();
      repositories.address.findOne.mockResolvedValue(owner());
      manager.count.mockResolvedValue(3);

      await expect(
        service.createRequest(TRADER, toCrypto(100), NOW),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(manager.count).toHaveBeenCalledWith(AccountTransaction, {
        where: {
          type: AccountTransactionType.Deposit,
          userId: TRADER,
          status: AccountTransactionStatus.Pending,
          expiresAt: MoreThan(NOW),
        },
      });
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('opens a pending request on the permanent address with its window', async () => {
      const { service, manager, repositories } = build();
      repositories.address.findOne.mockResolvedValue(owner());
      manager.count.mockResolvedValue(2);

      const row = await service.createRequest(TRADER, toCrypto(500), NOW);

      expect(manager.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        [`deposit_requests:${TRADER}`],
      );
      expect(manager.create).toHaveBeenCalledWith(AccountTransaction, {
        type: AccountTransactionType.Deposit,
        status: AccountTransactionStatus.Pending,
        statusReason: null,
        userId: TRADER,
        amount: toCrypto(500),
        address: ADDRESS,
        addressId: 7,
        expiresAt: new Date(NOW.getTime() + 45 * 60_000),
      });
      expect(row.id).toBe(100);
    });
  });

  describe('findOwn and cancelOwn', () => {
    it('finds only the caller’s own deposit, 404 otherwise', async () => {
      const { service, repositories } = build();

      await expect(service.findOwn(40, uuidOf(2))).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repositories.transactions.findOne).toHaveBeenCalledWith({
        where: {
          id: 40,
          userId: uuidOf(2),
          type: AccountTransactionType.Deposit,
        },
      });
    });

    it('returns the own deposit', async () => {
      const { service, repositories } = build();
      repositories.transactions.findOne.mockResolvedValue(deposit());

      await expect(service.findOwn(40, TRADER)).resolves.toMatchObject({
        id: 40,
      });
    });

    it('404 when canceling someone else’s request', async () => {
      const { service } = build();

      await expect(service.cancelOwn(40, uuidOf(2))).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it.each([
      AccountTransactionStatus.Processing,
      AccountTransactionStatus.Completed,
      AccountTransactionStatus.Canceled,
    ])('refuses to cancel a %s deposit', async (status) => {
      const { service, manager } = build();
      manager.findOne.mockResolvedValue(deposit({ status }));

      await expect(service.cancelOwn(40, TRADER)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('cancels a pending request under a row lock', async () => {
      const { service, manager } = build();
      manager.findOne.mockResolvedValue(deposit());

      const row = await service.cancelOwn(40, TRADER);

      expect(manager.findOne).toHaveBeenCalledWith(AccountTransaction, {
        where: { id: 40, userId: TRADER, type: AccountTransactionType.Deposit },
        lock: { mode: 'pessimistic_write' },
      });
      expect(row).toMatchObject({
        status: AccountTransactionStatus.Canceled,
        statusReason: AccountTransactionStatusReason.CanceledByUser,
      });
    });
  });

  describe('expire', () => {
    it('cancels the due pending requests as expired, skipping locked or changed rows', async () => {
      const { service, repositories, lockedBuilder, manager } = build();
      const due = deposit({ id: 1 });
      repositories.transactions.find.mockResolvedValue([
        due,
        deposit({ id: 2 }),
      ]);
      lockedBuilder.getOne
        .mockResolvedValueOnce(due)
        .mockResolvedValueOnce(null);

      await expect(service.expire(NOW, 100)).resolves.toBe(1);

      expect(repositories.transactions.find).toHaveBeenCalledWith({
        where: {
          type: AccountTransactionType.Deposit,
          status: AccountTransactionStatus.Pending,
          expiresAt: LessThanOrEqual(NOW),
        },
        order: { expiresAt: 'ASC', id: 'ASC' },
        take: 100,
      });
      expect(lockedBuilder.setLock).toHaveBeenCalledWith('pessimistic_write');
      expect(lockedBuilder.setOnLocked).toHaveBeenCalledWith('skip_locked');
      expect(lockedBuilder.andWhere).toHaveBeenCalledWith(
        'entry.status = :status',
        { status: AccountTransactionStatus.Pending },
      );
      expect(due).toMatchObject({
        status: AccountTransactionStatus.Canceled,
        statusReason: AccountTransactionStatusReason.Expired,
      });
      expect(manager.save).toHaveBeenCalledTimes(1);
    });
  });

  describe('receive', () => {
    const ownedBy = (manager: ReturnType<typeof build>['manager']) =>
      manager.findOne.mockImplementation(
        byEntity(new Map<unknown, unknown>([[DepositAddress, owner()]])),
      );

    it('does nothing for an address nobody owns', async () => {
      const { service, manager, wallets } = build();

      await service.receive(manager as never, event(), tronAddress);

      expect(manager.save).not.toHaveBeenCalled();
      expect(wallets.creditDepositWithin).not.toHaveBeenCalled();
    });

    it('does nothing for a transfer already recorded', async () => {
      const { service, manager, wallets } = build();
      ownedBy(manager);
      manager.count.mockResolvedValue(1);

      await service.receive(manager as never, event(), tronAddress);

      expect(manager.count).toHaveBeenCalledWith(DepositTransfer, {
        where: { txHash: HASH, logIndex: 0 },
      });
      expect(manager.save).not.toHaveBeenCalled();
      expect(wallets.creditDepositWithin).not.toHaveBeenCalled();
    });

    it('attaches to the oldest live request asking exactly this amount', async () => {
      const { service, manager, wallets } = build();
      ownedBy(manager);
      const older = deposit({ id: 1, amount: toCrypto(50) });
      const exact = deposit({ id: 2, amount: toCrypto(100) });
      const later = deposit({ id: 3, amount: toCrypto(100) });
      manager.find.mockResolvedValue([older, exact, later]);

      await service.receive(manager as never, event(), tronAddress);

      expect(manager.find).toHaveBeenCalledWith(AccountTransaction, {
        where: {
          type: AccountTransactionType.Deposit,
          userId: TRADER,
          status: AccountTransactionStatus.Pending,
          expiresAt: MoreThan(NOW),
        },
        order: { createdAt: 'ASC', id: 'ASC' },
        lock: { mode: 'pessimistic_write' },
      });
      expect(exact.status).toBe(AccountTransactionStatus.Completed);
      expect(older.status).toBe(AccountTransactionStatus.Pending);
      expect(wallets.creditDepositWithin).toHaveBeenCalledWith(
        manager,
        TRADER,
        toCrypto(100),
        2,
      );
    });

    it('takes the oldest live request when no amount matches', async () => {
      const { service, manager, wallets } = build();
      ownedBy(manager);
      const oldest = deposit({ id: 1, amount: toCrypto(50) });
      manager.find.mockResolvedValue([
        oldest,
        deposit({ id: 2, amount: null }),
      ]);

      await service.receive(manager as never, event(), tronAddress);

      expect(oldest.status).toBe(AccountTransactionStatus.Completed);
      expect(wallets.creditDepositWithin).toHaveBeenCalledWith(
        manager,
        TRADER,
        toCrypto(100),
        1,
      );
    });

    it('creates a deposit without a request when none is live, and credits it', async () => {
      const { service, manager, wallets, audit } = build();
      ownedBy(manager);

      await service.receive(manager as never, event(), tronAddress);

      expect(manager.create).toHaveBeenCalledWith(AccountTransaction, {
        type: AccountTransactionType.Deposit,
        status: AccountTransactionStatus.Processing,
        statusReason: null,
        userId: TRADER,
        amount: null,
        address: ADDRESS,
        addressId: 7,
      });
      expect(manager.create).toHaveBeenCalledWith(DepositTransfer, {
        accountTransactionId: 100,
        txHash: HASH,
        logIndex: 0,
        fromAddress: OTHER,
        amount: toCrypto(100),
        blockNumber: '500',
        blockTime: NOW,
      });
      expect(wallets.creditDepositWithin).toHaveBeenCalledWith(
        manager,
        TRADER,
        toCrypto(100),
        100,
      );
      const saved = manager.save.mock.calls
        .map(([row]) => row as unknown as AccountTransaction)
        .find((row) => row.type === AccountTransactionType.Deposit)!;
      expect(saved).toMatchObject({
        status: AccountTransactionStatus.Completed,
        statusReason: null,
        amountReceived: toCrypto(100),
        creditedAmount: toCrypto(100),
        actorUserId: null,
        txHash: HASH,
      });
      expect(saved.completedAt).toBeInstanceOf(Date);
      expect(audit.record).toHaveBeenCalledWith(
        {
          actorUserId: null,
          targetUserId: TRADER,
          action: 'deposit.credited',
          metadata: { accountTransactionId: 100, amount: '100.000000' },
        },
        manager,
      );
      expect(audit.record).toHaveBeenCalledWith(
        {
          actorUserId: null,
          targetUserId: TRADER,
          action: ActivityAction.DepositCredited,
          metadata: { accountTransactionId: 100, amount: '100.000000' },
        },
        manager,
      );
    });

    it('accumulates a transfer below the minimum without crediting it', async () => {
      const { service, manager, wallets } = build();
      ownedBy(manager);
      manager.find.mockImplementation(async (entity: unknown) =>
        entity === DepositTransfer ? [{ amount: toCrypto(4) }] : [],
      );

      await service.receive(
        manager as never,
        event({ amount: toCrypto(4) }),
        tronAddress,
      );

      expect(manager.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        ['deposit_accumulation:7'],
      );
      expect(manager.create).toHaveBeenCalledWith(AccountTransaction, {
        type: AccountTransactionType.Deposit,
        status: AccountTransactionStatus.Processing,
        statusReason: AccountTransactionStatusReason.BelowMinimum,
        userId: TRADER,
        amount: null,
        address: ADDRESS,
        addressId: 7,
      });
      expect(wallets.creditDepositWithin).not.toHaveBeenCalled();
      const row = manager.save.mock.calls
        .map(([saved]) => saved as unknown as AccountTransaction)
        .find((saved) => saved.type === AccountTransactionType.Deposit)!;
      expect(row).toMatchObject({
        status: AccountTransactionStatus.Processing,
        amountReceived: toCrypto(4),
      });
    });

    it('credits the accumulated sum once it reaches the minimum, on the same row', async () => {
      const { service, manager, wallets } = build();
      const accumulating = deposit({
        id: 60,
        status: AccountTransactionStatus.Processing,
        statusReason: AccountTransactionStatusReason.BelowMinimum,
        amount: null,
      });
      manager.findOne.mockImplementation(
        byEntity(
          new Map<unknown, unknown>([
            [DepositAddress, owner()],
            [AccountTransaction, accumulating],
          ]),
        ),
      );
      manager.find.mockImplementation(async (entity: unknown) =>
        entity === DepositTransfer
          ? [{ amount: toCrypto(4) }, { amount: toCrypto(6) }]
          : [],
      );

      await service.receive(
        manager as never,
        event({ amount: toCrypto(6) }),
        tronAddress,
      );

      expect(manager.findOne).toHaveBeenCalledWith(AccountTransaction, {
        where: {
          type: AccountTransactionType.Deposit,
          addressId: 7,
          status: AccountTransactionStatus.Processing,
          statusReason: AccountTransactionStatusReason.BelowMinimum,
        },
        lock: { mode: 'pessimistic_write' },
      });
      expect(accumulating).toMatchObject({
        status: AccountTransactionStatus.Completed,
        statusReason: null,
        creditedAmount: toCrypto(10),
      });
      expect(wallets.creditDepositWithin).toHaveBeenCalledWith(
        manager,
        TRADER,
        toCrypto(10),
        60,
      );
    });
  });

  describe('manual credit', () => {
    const failed = () => deposit({ status: AccountTransactionStatus.Failed });

    it('verifies a hash without writing anything', async () => {
      const { service, repositories, manager, dataSource } = build();
      repositories.transactions.findOne.mockResolvedValue(failed());

      await expect(service.verifyForCredit(40, HASH)).resolves.toEqual({
        inspection: { status: 'confirmed', transfers: [event()] },
        creditable: true,
        amount: '100.000000',
        reason: null,
      });
      expect(manager.save).not.toHaveBeenCalled();
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('reports why a hash cannot be credited', async () => {
      const { service, repositories, verifier } = build();
      repositories.transactions.findOne.mockResolvedValue(failed());
      verifier.inspectUsdtTransfer.mockResolvedValue({
        status: 'confirmed',
        transfers: [event({ to: OTHER })],
      });

      await expect(service.verifyForCredit(40, HASH)).resolves.toMatchObject({
        creditable: false,
        amount: null,
        reason: 'The transfer did not go to this deposit address',
      });
    });

    it('404 when verifying an unknown deposit', async () => {
      const { service } = build();

      await expect(service.verifyForCredit(40, HASH)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it.each([
      ['not_found', ConflictException],
      ['pending', ConflictException],
      ['failed', BadRequestException],
      ['not_usdt', BadRequestException],
    ] as const)('refuses a %s transaction', async (status, error) => {
      const { service, manager, verifier, wallets } = build();
      verifier.inspectUsdtTransfer.mockResolvedValue({ status, transfers: [] });
      manager.findOne.mockResolvedValue(failed());

      await expect(
        service.creditManually(40, HASH, ADMIN),
      ).rejects.toBeInstanceOf(error);
      expect(wallets.creditDepositWithin).not.toHaveBeenCalled();
    });

    it('refuses a transfer to another address', async () => {
      const { service, manager, verifier } = build();
      verifier.inspectUsdtTransfer.mockResolvedValue({
        status: 'confirmed',
        transfers: [event({ to: OTHER })],
      });
      manager.findOne.mockResolvedValue(failed());

      await expect(
        service.creditManually(40, HASH, ADMIN),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a deposit that is already credited, saying so', async () => {
      const { service, manager } = build();
      manager.findOne.mockResolvedValue(
        deposit({ status: AccountTransactionStatus.Completed }),
      );

      await expect(service.creditManually(40, HASH, ADMIN)).rejects.toThrow(
        new ConflictException('The deposit is already credited'),
      );
    });

    it('refuses a pending deposit: only one that needs a check is credited by hand', async () => {
      const { service, manager } = build();
      manager.findOne.mockResolvedValue(deposit());

      await expect(
        service.creditManually(40, HASH, ADMIN),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses a transfer already attached anywhere', async () => {
      const { service, manager } = build();
      manager.findOne.mockResolvedValue(failed());
      manager.count.mockResolvedValue(1);

      await expect(service.creditManually(40, HASH, ADMIN)).rejects.toThrow(
        new ConflictException('This transfer is already credited'),
      );
      expect(manager.count).toHaveBeenCalledWith(DepositTransfer, {
        where: [{ txHash: HASH, logIndex: 0 }],
      });
    });

    it('404 for an unknown deposit', async () => {
      const { service } = build();

      await expect(
        service.creditManually(40, HASH, ADMIN),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('attaches the transfers, credits with the admin as actor and audits the manual credit', async () => {
      const { service, manager, wallets, audit } = build();
      const row = failed();
      manager.findOne.mockResolvedValue(row);

      const credited = await service.creditManually(40, HASH, ADMIN);

      expect(manager.findOne).toHaveBeenCalledWith(AccountTransaction, {
        where: { id: 40, type: AccountTransactionType.Deposit },
        lock: { mode: 'pessimistic_write' },
      });
      expect(manager.create).toHaveBeenCalledWith(
        DepositTransfer,
        expect.objectContaining({ accountTransactionId: 40, txHash: HASH }),
      );
      expect(credited).toMatchObject({
        status: AccountTransactionStatus.Completed,
        creditedAmount: toCrypto(100),
        actorUserId: ADMIN,
        txHash: HASH,
      });
      expect(wallets.creditDepositWithin).toHaveBeenCalledWith(
        manager,
        TRADER,
        toCrypto(100),
        40,
      );
      expect(audit.record).toHaveBeenCalledWith(
        {
          actorUserId: ADMIN,
          targetUserId: TRADER,
          action: 'deposit.credited_manually',
          metadata: { accountTransactionId: 40, txHash: HASH },
        },
        manager,
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'deposit.credited',
          actorUserId: ADMIN,
        }),
        manager,
      );
    });
  });

  describe('crediting by hash', () => {
    const secondOwner = {
      id: 2,
      userId: uuidOf(2),
      tronAddressId: 8,
      address: OTHER,
    } as DepositAddress;

    it.each([
      ['not found', 'not_found', ConflictException],
      ['pending', 'pending', ConflictException],
      ['failed', 'failed', BadRequestException],
      ['not USDT', 'not_usdt', BadRequestException],
    ])(
      'plans a refusal for a %s transaction',
      async (_label, status, error) => {
        const built = build();
        built.verifier.inspectUsdtTransfer.mockResolvedValue({
          status: status as UsdtTransferInspection['status'],
          transfers: [],
        });

        const plan = await built.service.planCreditByHash(HASH);

        expect(plan.refusal).toBeInstanceOf(error);
        expect(plan.candidates).toEqual([]);
        expect(built.repositories.address.find).not.toHaveBeenCalled();
      },
    );

    it('refuses a transfer to no trader’s deposit address (400)', async () => {
      const built = build();

      const plan = await built.service.planCreditByHash(HASH);

      expect(plan.refusal).toBeInstanceOf(BadRequestException);
      await expect(
        built.service.creditByHash(HASH, ADMIN),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(built.dataSource.transaction).not.toHaveBeenCalled();
    });

    it('refuses when every transfer is already credited (409)', async () => {
      const built = build();
      built.repositories.address.find.mockResolvedValue([owner()]);
      built.repositories.transfers.count.mockResolvedValue(1);

      const plan = await built.service.planCreditByHash(HASH);

      expect(plan.refusal).toBeInstanceOf(ConflictException);
      expect(plan.candidates[0]).toMatchObject({
        userId: TRADER,
        alreadyCredited: true,
      });
    });

    it('credits one row per owning address with the sum of its transfers', async () => {
      const built = build();
      built.verifier.inspectUsdtTransfer.mockResolvedValue({
        status: 'confirmed',
        transfers: [
          event({ logIndex: 0, amount: toCrypto(30) }),
          event({ logIndex: 1, amount: toCrypto('12.5') }),
          event({ logIndex: 2, to: OTHER, amount: toCrypto(5) }),
        ],
      });
      built.repositories.address.find.mockResolvedValue([owner(), secondOwner]);

      const rows = await built.service.creditByHash(HASH, ADMIN);

      expect(rows).toHaveLength(2);
      expect(built.manager.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        ['deposit_accumulation:7'],
      );
      expect(built.wallets.creditDepositWithin).toHaveBeenCalledWith(
        built.manager,
        TRADER,
        toCrypto('42.5'),
        rows[0].id,
      );
      expect(built.wallets.creditDepositWithin).toHaveBeenCalledWith(
        built.manager,
        uuidOf(2),
        toCrypto(5),
        rows[1].id,
      );
      expect(rows[0]).toMatchObject({
        type: AccountTransactionType.Deposit,
        status: AccountTransactionStatus.Completed,
        amount: null,
        actorUserId: ADMIN,
        txHash: HASH,
        address: ADDRESS,
        addressId: 7,
      });
      expect(built.audit.record).toHaveBeenCalledWith(
        {
          actorUserId: ADMIN,
          targetUserId: TRADER,
          action: 'deposit.credited_manually',
          metadata: { accountTransactionId: rows[0].id, txHash: HASH },
        },
        built.manager,
      );
      const attached = built.manager.create.mock.calls.filter(
        ([entity]) => entity === DepositTransfer,
      );
      expect(attached).toHaveLength(3);
    });

    it('skips a candidate that became credited under the lock', async () => {
      const built = build();
      built.verifier.inspectUsdtTransfer.mockResolvedValue({
        status: 'confirmed',
        transfers: [event(), event({ logIndex: 1, to: OTHER })],
      });
      built.repositories.address.find.mockResolvedValue([owner(), secondOwner]);
      built.manager.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

      const rows = await built.service.creditByHash(HASH, ADMIN);

      expect(rows).toHaveLength(1);
      expect(rows[0].userId).toBe(uuidOf(2));
    });

    it('answers 409 when everything became credited under the lock', async () => {
      const built = build();
      built.repositories.address.find.mockResolvedValue([owner()]);
      built.manager.count.mockResolvedValue(1);

      await expect(
        built.service.creditByHash(HASH, ADMIN),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(built.wallets.creditDepositWithin).not.toHaveBeenCalled();
    });
  });
});
