import { BadRequestException, ConflictException } from '@nestjs/common';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { toCrypto } from '../../common/utils/to-crypto';
import { BalanceKind } from '../../transactions/types/balance-kind.enum';
import { TransfersService } from '../services/transfers.service';
import { AccountTransaction } from '../entities/account-transaction.entity';
import { AccountTransactionStatus } from '../types/account-transaction-status.enum';
import { AccountTransactionType } from '../types/account-transaction-type.enum';

const SENDER = uuidOf(1);
const RECIPIENT = uuidOf(2);
const ADMIN = uuidOf(9);

const build = () => {
  const manager = {
    create: jest.fn((_entity: unknown, data: object) => ({ ...data })),
    save: jest.fn(async (row: object) => ({ id: 41, ...row })),
  };
  const dataSource = {
    transaction: jest.fn(
      async (work: (entityManager: typeof manager) => unknown) => work(manager),
    ),
  };
  const wallets = {
    transferWithin: jest.fn(async () => undefined),
    moveBetweenOwnBalancesWithin: jest.fn(async () => undefined),
  };
  const audit = { record: jest.fn(async () => undefined) };
  const service = new TransfersService(
    dataSource as never,
    wallets as never,
    audit as never,
  );

  return { service, manager, dataSource, wallets, audit };
};

const input = {
  fromUserId: SENDER,
  toUserId: RECIPIENT,
  amount: toCrypto('12.5'),
  actorUserId: ADMIN,
  comment: 'monthly share',
};

describe('TransfersService.transfer', () => {
  it('writes one completed transfer row with both sides', async () => {
    const { service, manager } = build();

    const transfer = await service.transfer(input);

    expect(manager.create).toHaveBeenCalledWith(
      AccountTransaction,
      expect.objectContaining({
        type: AccountTransactionType.Transfer,
        status: AccountTransactionStatus.Completed,
        statusReason: null,
        userId: SENDER,
        counterpartyUserId: RECIPIENT,
        amount: toCrypto('12.5'),
        comment: 'monthly share',
        actorUserId: ADMIN,
        completedAt: expect.any(Date),
      }),
    );
    expect(transfer.id).toBe(41);
  });

  it('stores a missing comment as null', async () => {
    const { service, manager } = build();

    await service.transfer({ ...input, comment: undefined });

    expect(manager.create).toHaveBeenCalledWith(
      AccountTransaction,
      expect.objectContaining({ comment: null }),
    );
  });

  it('moves the money and writes the audit row in the same transaction, after the row exists', async () => {
    const { service, manager, dataSource, wallets, audit } = build();

    await service.transfer(input);

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(wallets.transferWithin).toHaveBeenCalledWith(
      manager,
      SENDER,
      RECIPIENT,
      toCrypto('12.5'),
      41,
    );
    expect(manager.save.mock.invocationCallOrder[0]).toBeLessThan(
      wallets.transferWithin.mock.invocationCallOrder[0],
    );
    expect(audit.record).toHaveBeenCalledWith(
      {
        actorUserId: ADMIN,
        targetUserId: RECIPIENT,
        action: 'user.transfer',
        metadata: {
          accountTransactionId: 41,
          fromUserId: SENDER,
          toUserId: RECIPIENT,
          amount: '12.500000',
        },
      },
      manager,
    );
  });

  it('propagates a refused movement and writes no audit row, so the transaction rolls the row back', async () => {
    const { service, wallets, audit } = build();
    wallets.transferWithin.mockRejectedValue(
      new ConflictException('Insufficient available balance'),
    );

    await expect(service.transfer(input)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('TransfersService.transferOwnBalance', () => {
  const own = {
    userId: SENDER,
    from: BalanceKind.Main,
    to: BalanceKind.InsurancePayIn,
    amount: toCrypto('250.5'),
    actorUserId: SENDER,
  };

  it('writes one transfer row naming both balances, the account on both sides', async () => {
    const { service } = build();

    const row = await service.transferOwnBalance(own);

    expect(row).toMatchObject({
      id: 41,
      type: AccountTransactionType.Transfer,
      status: AccountTransactionStatus.Completed,
      userId: SENDER,
      counterpartyUserId: SENDER,
      fromBalance: BalanceKind.Main,
      toBalance: BalanceKind.InsurancePayIn,
      amount: toCrypto('250.5'),
    });
  });

  it('moves the money with the row id and passes the delay check on', async () => {
    const { service, wallets, manager } = build();
    const now = new Date('2026-11-07T10:00:00Z');

    await service.transferOwnBalance({ ...own, insuranceDelayCheckedAt: now });

    expect(wallets.moveBetweenOwnBalancesWithin).toHaveBeenCalledWith(manager, {
      userId: SENDER,
      from: BalanceKind.Main,
      to: BalanceKind.InsurancePayIn,
      amount: toCrypto('250.5'),
      accountTransactionId: 41,
      insuranceDelayCheckedAt: now,
    });
  });

  it('audits the movement with the amount as a formatted string', async () => {
    const { service, audit, manager } = build();

    await service.transferOwnBalance({ ...own, actorUserId: ADMIN });

    expect(audit.record).toHaveBeenCalledWith(
      {
        actorUserId: ADMIN,
        targetUserId: SENDER,
        impersonatorUserId: null,
        action: 'balance.transfer',
        metadata: {
          accountTransactionId: 41,
          from: BalanceKind.Main,
          to: BalanceKind.InsurancePayIn,
          amount: '250.500000',
        },
      },
      manager,
    );
  });

  it('refuses the same balance on both sides before opening a transaction', async () => {
    const { service, dataSource } = build();

    await expect(
      service.transferOwnBalance({ ...own, to: BalanceKind.Main }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('writes no audit row when the wallet refuses', async () => {
    const { service, wallets, audit } = build();
    wallets.moveBetweenOwnBalancesWithin.mockRejectedValueOnce(
      new ConflictException('Insufficient available balance'),
    );

    await expect(service.transferOwnBalance(own)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(audit.record).not.toHaveBeenCalled();
  });
});
