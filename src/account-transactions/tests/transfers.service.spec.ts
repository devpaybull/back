import { ConflictException } from '@nestjs/common';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { toCrypto } from '../../common/utils/to-crypto';
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
  const wallets = { transferWithin: jest.fn(async () => undefined) };
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
