import { Logger } from '@nestjs/common';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { toCrypto } from '../../common/utils/to-crypto';
import { TronOutgoingTransfer } from '../../tron/entities/tron-outgoing-transfer.entity';
import { OutgoingTransferStatus } from '../../tron/types/outgoing-transfer-status.enum';
import { TronUnavailableError } from '../../tron/types/tron-unavailable.error';
import { AccountTransaction } from '../entities/account-transaction.entity';
import { WithdrawalAttempt } from '../entities/withdrawal-attempt.entity';
import { PayoutQueueService } from '../services/payout-queue.service';
import { AccountTransactionStatus } from '../types/account-transaction-status.enum';
import { AccountTransactionStatusReason } from '../types/account-transaction-status-reason.enum';
import { AccountTransactionType } from '../types/account-transaction-type.enum';

const HOT = 'THotWa11etAddressxxxxxxxxxxxxxxxxx';
const EXTERNAL = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

const withdrawal = (
  overrides: Partial<AccountTransaction> = {},
): AccountTransaction =>
  ({
    id: 41,
    type: AccountTransactionType.Withdrawal,
    status: AccountTransactionStatus.Pending,
    statusReason: null,
    userId: uuidOf(1),
    amount: toCrypto(100),
    fee: toCrypto('0.5'),
    address: EXTERNAL,
    ...overrides,
  }) as AccountTransaction;

const build = (mode = 'auto') => {
  const claimed: { row: AccountTransaction | null } = { row: null };
  const builder = {
    setLock: jest.fn(() => builder),
    setOnLocked: jest.fn(() => builder),
    where: jest.fn(() => builder),
    andWhere: jest.fn(() => builder),
    getOne: jest.fn(async () => claimed.row),
  };
  const locked: { row: AccountTransaction | null } = { row: null };
  const manager = {
    getRepository: jest.fn(() => ({ createQueryBuilder: () => builder })),
    create: jest.fn((_entity: unknown, data: object) => ({ ...data })),
    save: jest.fn(async (row: object) =>
      'accountTransactionId' in row ? { id: 7, ...row } : row,
    ),
    update: jest.fn(async () => undefined),
    findOne: jest.fn(async () => locked.row),
  };
  const queued: AccountTransaction[] = [];
  const processing: AccountTransaction[] = [];
  const unlinked: WithdrawalAttempt[] = [];
  const attemptRepository = {
    find: jest.fn(async () => unlinked),
    update: jest.fn(async () => undefined),
  };
  const dataSource = {
    getRepository: jest.fn((entity: unknown) =>
      entity === AccountTransaction
        ? {
            find: jest.fn(
              async (options: {
                where: { status: AccountTransactionStatus };
              }) =>
                options.where.status === AccountTransactionStatus.Processing
                  ? processing
                  : queued,
            ),
          }
        : attemptRepository,
    ),
    transaction: jest.fn(async (work: (m: typeof manager) => unknown) =>
      work(manager),
    ),
  };
  const config = {
    get: jest.fn((key: string, fallback?: unknown) =>
      key === 'PAYOUT_MODE' ? mode : fallback,
    ),
  };
  const sender = {
    sendUsdt: jest.fn(
      async () =>
        ({
          id: 90,
          status: OutgoingTransferStatus.Broadcast,
          txHash: 'b'.repeat(64),
        }) as TronOutgoingTransfer,
    ),
    findByKey: jest.fn(async (): Promise<TronOutgoingTransfer | null> => null),
  };
  const withdrawals = { onAttemptFinal: jest.fn(async () => undefined) };
  const keyring = { hotAddress: jest.fn(async () => HOT) };
  const verifier = { usdtBalanceOf: jest.fn(async () => toCrypto(1000)) };
  const energy = {
    estimateUsdtTransfer: jest.fn(async () => ({
      energy: 65000,
      bandwidth: 350,
      burnSun: '1000000',
    })),
    canPayFrom: jest.fn(async () => true),
  };
  const service = new PayoutQueueService(
    config as never,
    sender as never,
    keyring as never,
    verifier as never,
    energy as never,
    withdrawals as never,
    dataSource as never,
  );

  return {
    service,
    manager,
    builder,
    claimed,
    locked,
    queued,
    processing,
    unlinked,
    withdrawals,
    attemptRepository,
    sender,
    verifier,
    energy,
  };
};

describe('PayoutQueueService', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('in manual mode', () => {
    it('still starts its timer, to recover attempts left behind', () => {
      const setInterval = jest.spyOn(global, 'setInterval');
      const { service } = build('manual');

      service.onModuleInit();
      service.onModuleDestroy();

      expect(setInterval).toHaveBeenCalled();
    });

    it('returns an attempt that never reached the sender to the queue for an admin', async () => {
      const built = build('manual');
      built.locked.row = withdrawal({
        status: AccountTransactionStatus.Processing,
      });
      built.unlinked.push({
        id: 7,
        accountTransactionId: 41,
        accountTransaction: withdrawal({
          status: AccountTransactionStatus.Processing,
        }),
      } as WithdrawalAttempt);

      await built.service.tick();

      expect(built.sender.sendUsdt).not.toHaveBeenCalled();
      expect(built.locked.row.status).toBe(AccountTransactionStatus.Pending);
    });

    it('sends nothing on a tick', async () => {
      const built = build('manual');
      built.queued.push(withdrawal());

      await expect(built.service.tick()).resolves.toBe(0);
      expect(built.sender.sendUsdt).not.toHaveBeenCalled();
    });
  });

  describe('in auto mode', () => {
    it('starts an unref’d timer and clears it on shutdown', () => {
      const { service } = build();

      service.onModuleInit();
      service.onModuleDestroy();

      expect((service as unknown as { timer: unknown }).timer).toBeNull();
    });

    it('stops the batch while the hot wallet holds less USDT than the withdrawal', async () => {
      const built = build();
      built.queued.push(withdrawal());
      built.verifier.usdtBalanceOf.mockResolvedValue(toCrypto('99.999999'));

      await expect(built.service.run()).resolves.toBe(0);
      expect(built.builder.getOne).not.toHaveBeenCalled();
      expect(built.sender.sendUsdt).not.toHaveBeenCalled();
    });

    it('stops the batch while the hot wallet has neither energy nor TRX', async () => {
      const built = build();
      built.queued.push(withdrawal());
      built.energy.canPayFrom.mockResolvedValue(false);

      await expect(built.service.run()).resolves.toBe(0);
      expect(built.energy.estimateUsdtTransfer).toHaveBeenCalledWith(
        HOT,
        EXTERNAL,
        toCrypto(100),
      );
      expect(built.sender.sendUsdt).not.toHaveBeenCalled();
    });

    it('claims the row under skip-locked, opens a building attempt and sends from the hot key', async () => {
      const built = build();
      const row = withdrawal();
      built.queued.push(row);
      built.claimed.row = row;

      await expect(built.service.run()).resolves.toBe(1);

      expect(built.builder.setLock).toHaveBeenCalledWith('pessimistic_write');
      expect(built.builder.setOnLocked).toHaveBeenCalledWith('skip_locked');
      expect(row.status).toBe(AccountTransactionStatus.Processing);
      expect(built.manager.create).toHaveBeenCalledWith(WithdrawalAttempt, {
        accountTransactionId: 41,
        outgoingTransferId: null,
        txHash: null,
        status: OutgoingTransferStatus.Building,
        amountSent: toCrypto(100),
      });
      expect(built.sender.sendUsdt).toHaveBeenCalledWith({
        idempotencyKey: 'withdrawal:41:7',
        from: { kind: 'hot' },
        to: EXTERNAL,
        amount: toCrypto(100),
      });
      expect(built.attemptRepository.update).toHaveBeenCalledWith(7, {
        outgoingTransferId: 90,
        txHash: 'b'.repeat(64),
        status: OutgoingTransferStatus.Broadcast,
      });
    });

    it('skips a row another instance claimed first', async () => {
      const built = build();
      built.queued.push(withdrawal());

      await expect(built.service.run()).resolves.toBe(0);
      expect(built.sender.sendUsdt).not.toHaveBeenCalled();
    });

    it('puts the row back in the queue when the network was unreachable', async () => {
      const built = build();
      const row = withdrawal();
      built.queued.push(row);
      built.claimed.row = row;
      built.locked.row = withdrawal({
        status: AccountTransactionStatus.Processing,
      });
      built.sender.sendUsdt.mockRejectedValue(
        new TronUnavailableError('node down'),
      );

      await built.service.run();

      expect(built.manager.update).toHaveBeenCalledWith(WithdrawalAttempt, 7, {
        status: OutgoingTransferStatus.Failed,
        txHash: null,
      });
      expect(built.locked.row.status).toBe(AccountTransactionStatus.Pending);
      expect(built.locked.row.statusReason).toBeNull();
    });

    it('fails the row with an error on any other refusal', async () => {
      const built = build();
      const row = withdrawal();
      built.queued.push(row);
      built.claimed.row = row;
      built.locked.row = withdrawal({
        status: AccountTransactionStatus.Processing,
      });
      built.sender.sendUsdt.mockRejectedValue(new Error('bad transaction'));

      await built.service.run();

      expect(built.locked.row.status).toBe(AccountTransactionStatus.Failed);
      expect(built.locked.row.statusReason).toBe(
        AccountTransactionStatusReason.Error,
      );
    });

    it('unclaims when the sender hands back a transfer that failed before signing', async () => {
      const built = build();
      const row = withdrawal();
      built.queued.push(row);
      built.claimed.row = row;
      built.locked.row = withdrawal({
        status: AccountTransactionStatus.Processing,
      });
      built.sender.sendUsdt.mockResolvedValue({
        id: 90,
        status: OutgoingTransferStatus.Failed,
        txHash: null,
        failureReason: 'not sent: refused',
      } as TronOutgoingTransfer);

      await built.service.run();

      expect(built.attemptRepository.update).not.toHaveBeenCalled();
      expect(built.manager.update).toHaveBeenCalledWith(WithdrawalAttempt, 7, {
        status: OutgoingTransferStatus.Failed,
        txHash: null,
      });
      expect(built.locked.row.status).toBe(AccountTransactionStatus.Failed);
    });

    it('counts what is in flight and what this run already sent against the hot balance', async () => {
      const built = build();
      built.processing.push(withdrawal({ amount: toCrypto(850) }));
      const first = withdrawal({ id: 41 });
      const second = withdrawal({ id: 42 });
      built.queued.push(first, second);
      built.claimed.row = first;

      await expect(built.service.run()).resolves.toBe(1);
      expect(built.sender.sendUsdt).toHaveBeenCalledTimes(1);
    });

    it('links instead of unclaiming when the transfer got a hash before the error', async () => {
      const built = build();
      const row = withdrawal();
      built.queued.push(row);
      built.claimed.row = row;
      built.sender.sendUsdt.mockRejectedValue(new Error('database blip'));
      built.sender.findByKey.mockResolvedValue({
        id: 90,
        status: OutgoingTransferStatus.Broadcast,
        txHash: 'c'.repeat(64),
      } as TronOutgoingTransfer);

      await built.service.run();

      expect(built.sender.findByKey).toHaveBeenCalledWith('withdrawal:41:7');
      expect(built.attemptRepository.update).toHaveBeenCalledWith(7, {
        outgoingTransferId: 90,
        txHash: 'c'.repeat(64),
        status: OutgoingTransferStatus.Broadcast,
      });
      expect(built.manager.update).not.toHaveBeenCalled();
    });

    it('finalizes the withdrawal at once when the linked transfer is already final', async () => {
      const built = build();
      const row = withdrawal();
      built.queued.push(row);
      built.claimed.row = row;
      const confirmed = {
        id: 90,
        status: OutgoingTransferStatus.Confirmed,
        txHash: 'd'.repeat(64),
      } as TronOutgoingTransfer;
      built.sender.sendUsdt.mockResolvedValue(confirmed);

      await built.service.run();

      expect(built.withdrawals.onAttemptFinal).toHaveBeenCalledWith(
        built.manager,
        confirmed,
      );
    });

    it('links a processing attempt to the outgoing transfer it already has, sending nothing', async () => {
      const built = build();
      built.unlinked.push({
        id: 7,
        accountTransactionId: 41,
        accountTransaction: withdrawal({
          status: AccountTransactionStatus.Processing,
        }),
      } as WithdrawalAttempt);
      built.sender.findByKey.mockResolvedValue({
        id: 90,
        status: OutgoingTransferStatus.Signed,
        txHash: 'e'.repeat(64),
      } as TronOutgoingTransfer);

      await built.service.tick();

      expect(built.sender.sendUsdt).not.toHaveBeenCalled();
      expect(built.attemptRepository.update).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ outgoingTransferId: 90 }),
      );
    });

    it('re-sends a building attempt of a processing row with the same key, and skips others', async () => {
      const built = build();
      built.unlinked.push(
        {
          id: 7,
          accountTransactionId: 41,
          accountTransaction: withdrawal({
            status: AccountTransactionStatus.Processing,
          }),
        } as WithdrawalAttempt,
        {
          id: 8,
          accountTransactionId: 42,
          accountTransaction: withdrawal({
            id: 42,
            status: AccountTransactionStatus.Failed,
          }),
        } as WithdrawalAttempt,
      );

      await built.service.tick();

      expect(built.attemptRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: OutgoingTransferStatus.Building,
          }),
        }),
      );
      expect(built.sender.sendUsdt).toHaveBeenCalledTimes(1);
      expect(built.sender.sendUsdt).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: 'withdrawal:41:7' }),
      );
    });
  });
});
