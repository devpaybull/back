import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { Crypto } from '../../common/types/crypto';
import { toCrypto } from '../../common/utils/to-crypto';
import { TronAddress } from '../../tron/entities/tron-address.entity';
import { TronOutgoingTransfer } from '../../tron/entities/tron-outgoing-transfer.entity';
import { AddressPurpose } from '../../tron/types/address-purpose.enum';
import { OutgoingTransferKind } from '../../tron/types/outgoing-transfer-kind.enum';
import { OutgoingTransferStatus } from '../../tron/types/outgoing-transfer-status.enum';
import { UsdtTransferInspection } from '../../tron/types/usdt-transfer-inspection';
import { AccountTransaction } from '../entities/account-transaction.entity';
import { DepositAddress } from '../entities/deposit-address.entity';
import { DepositTransfer } from '../entities/deposit-transfer.entity';
import { WithdrawalAttempt } from '../entities/withdrawal-attempt.entity';
import { WithdrawalQuote } from '../entities/withdrawal-quote.entity';
import { WithdrawalsService } from '../services/withdrawals.service';
import { AccountTransactionStatus } from '../types/account-transaction-status.enum';
import { AccountTransactionStatusReason } from '../types/account-transaction-status-reason.enum';
import { AccountTransactionType } from '../types/account-transaction-type.enum';
import { FeeChangedException } from '../types/fee-changed.error';

const TRADER = uuidOf(1);
const OTHER = uuidOf(2);
const ADMIN = uuidOf(9);
const HOT = 'THotWa11etAddressxxxxxxxxxxxxxxxxx';
const EXTERNAL = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const DEPOSIT_OF_OTHER = 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf';
const NOW = new Date('2026-10-25T12:00:00.000Z');
const HASH = 'a'.repeat(64);

const ENV: Record<string, unknown> = {
  WITHDRAWAL_QUOTE_TTL_SECONDS: 60,
  WITHDRAWAL_MIN_USDT: '10',
  WITHDRAWAL_DAILY_LIMIT_USDT: '1000',
  WITHDRAWAL_SECURITY_HOLD_HOURS: 24,
  WITHDRAWAL_TOTP_MAX_FAILURES: 3,
  WITHDRAWAL_TOTP_LOCK_MINUTES: 10,
};

type Finder = (entity: unknown, options?: unknown) => unknown;

const withdrawal = (
  overrides: Partial<AccountTransaction> = {},
): AccountTransaction =>
  ({
    id: 41,
    type: AccountTransactionType.Withdrawal,
    status: AccountTransactionStatus.Pending,
    statusReason: null,
    userId: TRADER,
    amount: toCrypto(100),
    fee: toCrypto('0.5'),
    address: EXTERNAL,
    paidManually: false,
    actorUserId: null,
    comment: null,
    txHash: null,
    completedAt: null,
    createdAt: new Date(NOW.getTime() - 3_600_000),
    ...overrides,
  }) as AccountTransaction;

const build = () => {
  const findOneBy = new Map<unknown, Finder>();
  const findBy = new Map<unknown, Finder>();
  const countBy = new Map<unknown, Finder>();
  const repoFindOne = new Map<unknown, Finder>();
  const repoFind = new Map<unknown, Finder>();
  const manager = {
    query: jest.fn(async () => undefined),
    findOne: jest.fn(
      async (entity: unknown, options?: unknown) =>
        findOneBy.get(entity)?.(entity, options) ?? null,
    ),
    find: jest.fn(
      async (entity: unknown, options?: unknown) =>
        findBy.get(entity)?.(entity, options) ?? [],
    ),
    count: jest.fn(
      async (entity: unknown, options?: unknown) =>
        countBy.get(entity)?.(entity, options) ?? 0,
    ),
    create: jest.fn((_entity: unknown, data: object) => ({ ...data })),
    save: jest.fn(async (row: object) => ({ id: 41, ...row })),
  };
  const quoteRepository = {
    save: jest.fn(async (row: object) => row),
    find: jest.fn(async () => [] as WithdrawalQuote[]),
  };
  const repository = (entity: unknown) =>
    entity === WithdrawalQuote
      ? quoteRepository
      : {
          findOne: jest.fn(
            async (options?: unknown) =>
              repoFindOne.get(entity)?.(entity, options) ?? null,
          ),
          find: jest.fn(
            async (options?: unknown) =>
              repoFind.get(entity)?.(entity, options) ?? [],
          ),
        };
  const dataSource = {
    getRepository: jest.fn(repository),
    manager,
    transaction: jest.fn(async (work: (m: typeof manager) => unknown) =>
      work(manager),
    ),
  };
  const config = {
    get: jest.fn((key: string) => ENV[key]),
    getOrThrow: jest.fn((key: string) => ENV[key]),
  };
  const wallets = {
    findByUserId: jest.fn(async () => ({ id: 1 })),
    getAvailableMain: jest.fn(() => toCrypto(200)),
    reserveMainEscrowWithin: jest.fn(async () => undefined),
    releaseEscrowWithin: jest.fn(async () => undefined),
    settleWithdrawalWithin: jest.fn(async () => undefined),
  };
  const audit = {
    record: jest.fn<Promise<void>, [{ action: string }, unknown?]>(
      async () => undefined,
    ),
  };
  const energy = {
    quoteUsdtTransferFee: jest.fn(async () => ({
      usdt: toCrypto('0.5'),
      trx: toCrypto('1.5'),
    })),
  };
  const keyring = {
    hotAddress: jest.fn(async () => HOT),
    findAddress: jest.fn(
      async (address: string) =>
        repoFindOne.get(TronAddress)?.(TronAddress, { where: { address } }) ??
        null,
    ),
  };
  const sender = { isHashUsedOutside: jest.fn(async () => false) };
  const verifier = {
    inspectUsdtTransfer: jest.fn(async (): Promise<UsdtTransferInspection> => ({
      status: 'confirmed',
      transfers: [],
    })),
  };
  const credentials = {
    spendWithdrawalTotp: jest.fn(
      async (): Promise<'accepted' | 'refused' | 'locked'> => 'accepted',
    ),
  };
  const directory = {
    requireById: jest.fn(async () => ({
      id: TRADER,
      passwordChangedAt: null,
      twoFactorResetAt: null,
    })),
  };
  const transfers = {
    transfer: jest.fn(async () => ({ id: 77, type: 'transfer' })),
  };
  const tracker = { register: jest.fn() };
  const service = new WithdrawalsService(
    config as never,
    wallets as never,
    audit as never,
    energy as never,
    keyring as never,
    verifier as never,
    sender as never,
    credentials as never,
    directory as never,
    transfers as never,
    tracker as never,
    dataSource as never,
  );

  return {
    service,
    manager,
    dataSource,
    quoteRepository,
    wallets,
    audit,
    energy,
    verifier,
    sender,
    credentials,
    directory,
    transfers,
    tracker,
    findOneBy,
    findBy,
    countBy,
    repoFindOne,
    repoFind,
  };
};

const liveQuote = (amount: Crypto, fee = '0.5'): WithdrawalQuote =>
  ({
    id: 3,
    userId: TRADER,
    address: EXTERNAL,
    amount,
    fee: toCrypto(fee),
    expiresAt: new Date(NOW.getTime() + 30_000),
  }) as WithdrawalQuote;

const platformDeposit = (built: ReturnType<typeof build>, owner: string) => {
  built.repoFindOne.set(TronAddress, () => ({
    id: 5,
    address: DEPOSIT_OF_OTHER,
    purpose: AddressPurpose.Deposit,
  }));
  built.repoFindOne.set(DepositAddress, () => ({
    userId: owner,
    tronAddressId: 5,
  }));
};

const input = (
  overrides: Partial<{ amount: Crypto; address: string }> = {},
) => ({
  userId: TRADER,
  address: EXTERNAL,
  amount: toCrypto(100),
  totp: '123456',
  ...overrides,
});

describe('WithdrawalsService', () => {
  it('registers its handler for the withdrawal key prefix', () => {
    const { tracker } = build();

    expect(tracker.register).toHaveBeenCalledWith(
      'withdrawal',
      expect.any(Function),
    );
  });

  describe('quote', () => {
    it('refuses an address that is not a Tron address', async () => {
      const { service } = build();

      await expect(
        service.quote(TRADER, 'not-an-address', toCrypto(10), NOW),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it.each([AddressPurpose.Hot, AddressPurpose.Energy])(
      'refuses the %s wallet of the platform',
      async (purpose) => {
        const built = build();
        built.repoFindOne.set(TronAddress, () => ({ id: 1, purpose }));

        await expect(
          built.service.quote(TRADER, EXTERNAL, toCrypto(10), NOW),
        ).rejects.toBeInstanceOf(BadRequestException);
      },
    );

    it('refuses the trader’s own deposit address', async () => {
      const built = build();
      platformDeposit(built, TRADER);

      await expect(
        built.service.quote(TRADER, DEPOSIT_OF_OTHER, toCrypto(10), NOW),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('quotes another trader’s deposit address as an internal transfer with no fee', async () => {
      const built = build();
      platformDeposit(built, OTHER);

      const quote = await built.service.quote(
        TRADER,
        DEPOSIT_OF_OTHER,
        toCrypto(10),
        NOW,
      );

      expect(quote.internal).toBe(true);
      expect(quote.fee.usdt).toEqual(toCrypto(0));
      expect(built.energy.quoteUsdtTransferFee).not.toHaveBeenCalled();
    });

    it('prices an external address from the hot wallet and stores the quote for its TTL', async () => {
      const built = build();

      const quote = await built.service.quote(
        TRADER,
        EXTERNAL,
        toCrypto(10),
        NOW,
      );

      expect(built.energy.quoteUsdtTransferFee).toHaveBeenCalledWith(
        HOT,
        EXTERNAL,
        toCrypto(10),
      );
      expect(quote).toMatchObject({
        available: toCrypto(200),
        maxAmount: toCrypto('199.5'),
        internal: false,
        expiresAt: new Date(NOW.getTime() + 60_000),
      });
      expect(built.quoteRepository.save).toHaveBeenCalledWith({
        userId: TRADER,
        address: EXTERNAL,
        amount: toCrypto(10),
        fee: toCrypto('0.5'),
        feeTrx: toCrypto('1.5'),
        expiresAt: new Date(NOW.getTime() + 60_000),
      });
    });

    it('never quotes a negative maximum', async () => {
      const built = build();
      built.wallets.getAvailableMain.mockReturnValue(toCrypto('0.2'));

      const quote = await built.service.quote(
        TRADER,
        EXTERNAL,
        toCrypto(10),
        NOW,
      );

      expect(quote.maxAmount).toEqual(toCrypto(0));
    });

    it('answers zero available for a trader with no wallet', async () => {
      const built = build();
      built.wallets.findByUserId.mockResolvedValue(null as never);

      const quote = await built.service.quote(
        TRADER,
        EXTERNAL,
        toCrypto(10),
        NOW,
      );

      expect(quote.available).toEqual(toCrypto(0));
      expect(built.wallets.getAvailableMain).not.toHaveBeenCalled();
    });
  });

  describe('request', () => {
    it('answers a wrong TOTP with the login message and writes nothing', async () => {
      const built = build();
      built.credentials.spendWithdrawalTotp.mockResolvedValue('refused');

      const refused = built.service.request(input(), NOW);

      await expect(refused).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(refused).rejects.toThrow(
        'Invalid login, password or one-time code',
      );
      expect(built.dataSource.transaction).not.toHaveBeenCalled();
      expect(built.quoteRepository.save).not.toHaveBeenCalled();
    });

    it('writes a refused-code audit row on a wrong TOTP', async () => {
      const built = build();
      built.credentials.spendWithdrawalTotp.mockResolvedValue('refused');

      await expect(built.service.request(input(), NOW)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(built.audit.record).toHaveBeenCalledWith({
        actorUserId: TRADER,
        targetUserId: TRADER,
        action: 'withdrawal.totp_refused',
        metadata: { locked: false },
      });
    });

    it('answers 429 while locked and records the lock', async () => {
      const built = build();
      built.credentials.spendWithdrawalTotp.mockResolvedValue('locked');

      const refused = built.service.request(input(), NOW);

      await expect(refused).rejects.toBeInstanceOf(HttpException);
      await expect(refused).rejects.toMatchObject({
        status: HttpStatus.TOO_MANY_REQUESTS,
      });
      expect(built.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'withdrawal.totp_refused',
          metadata: { locked: true },
        }),
      );
      expect(built.dataSource.transaction).not.toHaveBeenCalled();
    });

    it('spends the code with the configured limits and the request time', async () => {
      const built = build();
      built.credentials.spendWithdrawalTotp.mockResolvedValue('refused');

      await expect(built.service.request(input(), NOW)).rejects.toBeDefined();
      expect(built.credentials.spendWithdrawalTotp).toHaveBeenCalledWith(
        expect.objectContaining({ id: TRADER }),
        '123456',
        { maxFailures: 3, windowMinutes: 10 },
        NOW,
      );
    });

    it.each(['passwordChangedAt', 'twoFactorResetAt'])(
      'holds withdrawals after %s inside the hold',
      async (field) => {
        const built = build();
        built.directory.requireById.mockResolvedValue({
          id: TRADER,
          passwordChangedAt: null,
          twoFactorResetAt: null,
          [field]: new Date(NOW.getTime() - 23 * 3_600_000),
        });

        await expect(
          built.service.request(input(), NOW),
        ).rejects.toBeInstanceOf(ConflictException);
      },
    );

    it('lets a withdrawal through once the hold has passed', async () => {
      const built = build();
      built.directory.requireById.mockResolvedValue({
        id: TRADER,
        passwordChangedAt: new Date(NOW.getTime() - 25 * 3_600_000),
        twoFactorResetAt: null,
      });
      built.quoteRepository.find.mockResolvedValue([liveQuote(toCrypto(100))]);

      await expect(built.service.request(input(), NOW)).resolves.toBeDefined();
    });

    it('refuses an amount below the minimum', async () => {
      const built = build();

      await expect(
        built.service.request(input({ amount: toCrypto('9.99') }), NOW),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('turns a withdrawal to another trader’s deposit address into a transfer by the trader', async () => {
      const built = build();
      platformDeposit(built, OTHER);

      await built.service.request(input({ address: DEPOSIT_OF_OTHER }), NOW);

      expect(built.transfers.transfer).toHaveBeenCalledWith(
        {
          fromUserId: TRADER,
          toUserId: OTHER,
          amount: toCrypto(100),
          actorUserId: TRADER,
          comment: `Withdrawal to the deposit address ${DEPOSIT_OF_OTHER}`,
        },
        expect.any(Function),
      );
      expect(built.wallets.reserveMainEscrowWithin).not.toHaveBeenCalled();
    });

    it('holds the trader’s lock and the daily limit inside the internal transfer', async () => {
      const built = build();
      platformDeposit(built, OTHER);
      built.findBy.set(AccountTransaction, () => [
        withdrawal({
          type: AccountTransactionType.Transfer,
          amount: toCrypto('950'),
        }),
      ]);

      await built.service.request(input({ address: DEPOSIT_OF_OTHER }), NOW);
      const [, before] = built.transfers.transfer.mock.calls[0] as unknown as [
        unknown,
        (manager: unknown) => Promise<void>,
      ];

      await expect(before(built.manager)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(built.manager.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        [`withdrawals:${TRADER}`],
      );
    });

    it('answers 409 with the new fee and a fresh quote when no live quote matches', async () => {
      const built = build();
      built.quoteRepository.find.mockResolvedValue([liveQuote(toCrypto(50))]);
      built.energy.quoteUsdtTransferFee.mockResolvedValue({
        usdt: toCrypto('0.7'),
        trx: toCrypto(2),
      });

      const refused = built.service.request(input(), NOW);

      await expect(refused).rejects.toBeInstanceOf(FeeChangedException);
      await expect(refused).rejects.toMatchObject({
        response: expect.objectContaining({ fee: '0.700000' }),
      });
      expect(built.quoteRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: toCrypto(100),
          fee: toCrypto('0.7'),
        }),
      );
      expect(built.wallets.reserveMainEscrowWithin).not.toHaveBeenCalled();
    });

    it('looks for a live quote of this trader and address only', async () => {
      const built = build();
      built.quoteRepository.find.mockResolvedValue([liveQuote(toCrypto(100))]);

      await built.service.request(input(), NOW);

      expect(built.quoteRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: TRADER, address: EXTERNAL }),
        }),
      );
    });

    it('reserves amount plus the quoted fee under the trader’s lock and writes a pending row', async () => {
      const built = build();
      built.quoteRepository.find.mockResolvedValue([
        liveQuote(toCrypto(100), '0.25'),
      ]);

      const row = await built.service.request(input(), NOW);

      expect(built.manager.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        [`withdrawals:${TRADER}`],
      );
      expect(built.wallets.reserveMainEscrowWithin).toHaveBeenCalledWith(
        built.manager,
        TRADER,
        toCrypto('100.25'),
      );
      expect(built.manager.create).toHaveBeenCalledWith(AccountTransaction, {
        type: AccountTransactionType.Withdrawal,
        status: AccountTransactionStatus.Pending,
        statusReason: null,
        userId: TRADER,
        amount: toCrypto(100),
        fee: toCrypto('0.25'),
        address: EXTERNAL,
        paidManually: false,
      });
      expect(built.audit.record).toHaveBeenCalledWith(
        {
          actorUserId: TRADER,
          targetUserId: TRADER,
          action: 'withdrawal.requested',
          metadata: {
            accountTransactionId: 41,
            address: EXTERNAL,
            amount: '100.000000',
            fee: '0.250000',
          },
        },
        built.manager,
      );
      expect(row.id).toBe(41);
    });

    it('refuses a withdrawal that would pass the 24-hour limit, counting this one', async () => {
      const built = build();
      built.quoteRepository.find.mockResolvedValue([liveQuote(toCrypto(100))]);
      built.findBy.set(AccountTransaction, () => [
        withdrawal({ amount: toCrypto('900.000001') }),
      ]);

      await expect(built.service.request(input(), NOW)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(built.wallets.reserveMainEscrowWithin).not.toHaveBeenCalled();
    });

    it('allows a withdrawal that reaches the limit exactly', async () => {
      const built = build();
      built.quoteRepository.find.mockResolvedValue([liveQuote(toCrypto(100))]);
      built.findBy.set(AccountTransaction, () => [
        withdrawal({ amount: toCrypto(900) }),
      ]);

      await expect(built.service.request(input(), NOW)).resolves.toBeDefined();
      const [, options] = built.manager.find.mock.calls[0] as [
        unknown,
        {
          where: {
            type: AccountTransactionType;
            userId: string;
            actorUserId?: string;
            createdAt: { value: Date };
          }[];
        },
      ];
      expect(options.where[0].createdAt.value).toEqual(
        new Date(NOW.getTime() - 86_400_000),
      );
      expect(options.where[0].type).toBe(AccountTransactionType.Withdrawal);
      expect(options.where[1]).toMatchObject({
        type: AccountTransactionType.Transfer,
        userId: TRADER,
        actorUserId: TRADER,
      });
    });
  });

  describe('cancelOwn and reject', () => {
    it('cancels the trader’s own pending withdrawal and releases amount plus fee', async () => {
      const built = build();
      const row = withdrawal();
      built.findOneBy.set(AccountTransaction, () => row);

      await built.service.cancelOwn(41, TRADER);

      expect(built.manager.findOne).toHaveBeenCalledWith(
        AccountTransaction,
        expect.objectContaining({
          where: {
            id: 41,
            type: AccountTransactionType.Withdrawal,
            userId: TRADER,
          },
        }),
      );
      expect(built.wallets.releaseEscrowWithin).toHaveBeenCalledWith(
        built.manager,
        TRADER,
        toCrypto('100.5'),
      );
      expect(row.status).toBe(AccountTransactionStatus.Canceled);
      expect(row.statusReason).toBe(
        AccountTransactionStatusReason.CanceledByUser,
      );
      expect(built.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'withdrawal.canceled' }),
        built.manager,
      );
    });

    it('404 for somebody else’s withdrawal', async () => {
      const built = build();

      await expect(built.service.cancelOwn(41, TRADER)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('refuses to cancel a failed withdrawal — only an admin decides that one', async () => {
      const built = build();
      built.findOneBy.set(AccountTransaction, () =>
        withdrawal({ status: AccountTransactionStatus.Failed }),
      );

      await expect(built.service.cancelOwn(41, TRADER)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(built.wallets.releaseEscrowWithin).not.toHaveBeenCalled();
    });

    it.each([
      AccountTransactionStatus.Pending,
      AccountTransactionStatus.Failed,
    ])(
      'rejects a %s withdrawal with the admin and the reason',
      async (status) => {
        const built = build();
        const row = withdrawal({ status });
        built.findOneBy.set(AccountTransaction, () => row);

        await built.service.reject(41, ADMIN, 'Suspicious');

        expect(row).toMatchObject({
          status: AccountTransactionStatus.Canceled,
          statusReason: AccountTransactionStatusReason.RejectedByAdmin,
          comment: 'Suspicious',
          actorUserId: ADMIN,
        });
        expect(built.audit.record).toHaveBeenCalledWith(
          {
            actorUserId: ADMIN,
            targetUserId: TRADER,
            action: 'withdrawal.rejected',
            reason: 'Suspicious',
            metadata: { accountTransactionId: 41 },
          },
          built.manager,
        );
      },
    );

    it.each([
      AccountTransactionStatus.Processing,
      AccountTransactionStatus.Completed,
    ])('refuses to reject a %s withdrawal', async (status) => {
      const built = build();
      built.findOneBy.set(AccountTransaction, () => withdrawal({ status }));

      await expect(
        built.service.reject(41, ADMIN, 'Suspicious'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(built.wallets.releaseEscrowWithin).not.toHaveBeenCalled();
    });
  });

  describe('onAttemptFinal', () => {
    const transfer = (status: OutgoingTransferStatus) =>
      ({
        id: 8,
        idempotencyKey: 'withdrawal:41:3',
        kind: OutgoingTransferKind.Usdt,
        status,
        txHash: HASH,
        failureReason:
          status === OutgoingTransferStatus.Failed ? 'REVERT' : null,
      }) as TronOutgoingTransfer;

    it('ignores an outgoing transfer that belongs to no attempt', async () => {
      const built = build();

      await built.service.onAttemptFinal(
        built.manager as never,
        transfer(OutgoingTransferStatus.Confirmed),
      );

      expect(built.manager.save).not.toHaveBeenCalled();
      expect(built.wallets.settleWithdrawalWithin).not.toHaveBeenCalled();
    });

    it('completes the withdrawal when its attempt is confirmed', async () => {
      const built = build();
      const attempt = { id: 3, accountTransactionId: 41 } as WithdrawalAttempt;
      const row = withdrawal({ status: AccountTransactionStatus.Processing });
      built.findOneBy.set(WithdrawalAttempt, () => attempt);
      built.findOneBy.set(AccountTransaction, () => row);

      await built.service.onAttemptFinal(
        built.manager as never,
        transfer(OutgoingTransferStatus.Confirmed),
      );

      expect(built.manager.findOne).toHaveBeenCalledWith(WithdrawalAttempt, {
        where: { id: 3, accountTransactionId: 41 },
      });
      expect(attempt).toMatchObject({
        outgoingTransferId: 8,
        status: OutgoingTransferStatus.Confirmed,
        txHash: HASH,
      });
      expect(built.wallets.settleWithdrawalWithin).toHaveBeenCalledWith(
        built.manager,
        TRADER,
        toCrypto(100),
        toCrypto('0.5'),
        41,
      );
      expect(row.status).toBe(AccountTransactionStatus.Completed);
      expect(row.txHash).toBe(HASH);
      expect(row.completedAt).toBeInstanceOf(Date);
      expect(
        built.audit.record.mock.calls.map(([entry]) => entry.action),
      ).toEqual(['withdrawal.completed', 'activity.withdrawal_completed']);
      expect(built.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: {
            accountTransactionId: 41,
            txHash: HASH,
            amount: '100.000000',
            fee: '0.500000',
          },
        }),
        built.manager,
      );
    });

    it.each([OutgoingTransferStatus.Failed, OutgoingTransferStatus.Expired])(
      'marks the withdrawal failed on a %s attempt and keeps the reserve',
      async (status) => {
        const built = build();
        const row = withdrawal({ status: AccountTransactionStatus.Processing });
        built.findOneBy.set(WithdrawalAttempt, () => ({
          id: 3,
          accountTransactionId: 41,
        }));
        built.findOneBy.set(AccountTransaction, () => row);

        await built.service.onAttemptFinal(
          built.manager as never,
          transfer(status),
        );

        expect(row.status).toBe(AccountTransactionStatus.Failed);
        expect(row.statusReason).toBe(
          AccountTransactionStatusReason.NetworkFailed,
        );
        expect(built.wallets.settleWithdrawalWithin).not.toHaveBeenCalled();
        expect(built.wallets.releaseEscrowWithin).not.toHaveBeenCalled();
      },
    );

    it('leaves alone a withdrawal that is no longer processing', async () => {
      const built = build();
      const row = withdrawal({ status: AccountTransactionStatus.Completed });
      built.findOneBy.set(WithdrawalAttempt, () => ({
        id: 3,
        accountTransactionId: 41,
      }));
      built.findOneBy.set(AccountTransaction, () => row);

      await built.service.onAttemptFinal(
        built.manager as never,
        transfer(OutgoingTransferStatus.Confirmed),
      );

      expect(built.wallets.settleWithdrawalWithin).not.toHaveBeenCalled();
      expect(row.status).toBe(AccountTransactionStatus.Completed);
    });
  });

  describe('paying by hand', () => {
    const sentToAddress = (amount: string): UsdtTransferInspection => ({
      status: 'confirmed',
      transfers: [
        {
          txHash: HASH,
          logIndex: 0,
          from: HOT,
          to: EXTERNAL,
          amount: toCrypto(amount),
          blockNumber: 10,
          blockTime: NOW,
        },
      ],
    });

    it('verifies a hash without writing anything', async () => {
      const built = build();
      built.repoFindOne.set(AccountTransaction, () =>
        withdrawal({ status: AccountTransactionStatus.Failed }),
      );
      built.verifier.inspectUsdtTransfer.mockResolvedValue(
        sentToAddress('100'),
      );

      const verification = await built.service.verifyPayment(41, HASH);

      expect(verification).toMatchObject({
        completable: true,
        amountSent: '100.000000',
        reason: null,
      });
      expect(built.dataSource.transaction).not.toHaveBeenCalled();
      expect(built.manager.save).not.toHaveBeenCalled();
    });

    it('404 for an unknown withdrawal on verify', async () => {
      const built = build();

      await expect(
        built.service.verifyPayment(41, HASH),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each([
      ['not found', { status: 'not_found', transfers: [] }, ConflictException],
      ['pending', { status: 'pending', transfers: [] }, ConflictException],
      ['failed', { status: 'failed', transfers: [] }, BadRequestException],
      ['not USDT', { status: 'not_usdt', transfers: [] }, BadRequestException],
    ])('refuses a %s transaction', async (_label, inspection, error) => {
      const built = build();
      built.findOneBy.set(AccountTransaction, () =>
        withdrawal({ status: AccountTransactionStatus.Failed }),
      );
      built.verifier.inspectUsdtTransfer.mockResolvedValue(
        inspection as UsdtTransferInspection,
      );

      await expect(
        built.service.completeManually(41, HASH, ADMIN),
      ).rejects.toBeInstanceOf(error);
    });

    it('refuses a transfer that went to another address', async () => {
      const built = build();
      built.findOneBy.set(AccountTransaction, () =>
        withdrawal({
          status: AccountTransactionStatus.Failed,
          address: DEPOSIT_OF_OTHER,
        }),
      );
      built.verifier.inspectUsdtTransfer.mockResolvedValue(
        sentToAddress('100'),
      );

      await expect(
        built.service.completeManually(41, HASH, ADMIN),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a transfer smaller than the withdrawal', async () => {
      const built = build();
      built.findOneBy.set(AccountTransaction, () =>
        withdrawal({ status: AccountTransactionStatus.Failed }),
      );
      built.verifier.inspectUsdtTransfer.mockResolvedValue(
        sentToAddress('99.999999'),
      );

      await expect(
        built.service.completeManually(41, HASH, ADMIN),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it.each([
      AccountTransactionStatus.Pending,
      AccountTransactionStatus.Processing,
      AccountTransactionStatus.Completed,
      AccountTransactionStatus.Canceled,
    ])('refuses to close a %s withdrawal by hand', async (status) => {
      const built = build();
      built.findOneBy.set(AccountTransaction, () => withdrawal({ status }));
      built.verifier.inspectUsdtTransfer.mockResolvedValue(
        sentToAddress('100'),
      );

      await expect(
        built.service.completeManually(41, HASH, ADMIN),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses a hash an outgoing transfer of another row already holds', async () => {
      const built = build();
      built.findOneBy.set(AccountTransaction, () =>
        withdrawal({ status: AccountTransactionStatus.Failed }),
      );
      built.verifier.inspectUsdtTransfer.mockResolvedValue(
        sentToAddress('100'),
      );
      built.sender.isHashUsedOutside.mockResolvedValue(true);

      await expect(
        built.service.completeManually(41, HASH, ADMIN),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(built.sender.isHashUsedOutside).toHaveBeenCalledWith(
        HASH,
        'withdrawal:41:',
      );
    });

    it('counts only other rows’ attempts against the hash', async () => {
      const built = build();
      built.findOneBy.set(AccountTransaction, () =>
        withdrawal({ status: AccountTransactionStatus.Failed }),
      );
      built.verifier.inspectUsdtTransfer.mockResolvedValue(
        sentToAddress('100'),
      );

      await built.service.completeManually(41, HASH, ADMIN);

      const call = built.manager.count.mock.calls.find(
        ([entity]) => entity === WithdrawalAttempt,
      ) as unknown as [
        unknown,
        { where: { txHash: string; accountTransactionId: { value: number } } },
      ];
      expect(call[1].where.txHash).toBe(HASH);
      expect(call[1].where.accountTransactionId.value).toBe(41);
    });

    it('ignores a transfer to the address made before the withdrawal was requested', async () => {
      const built = build();
      built.findOneBy.set(AccountTransaction, () =>
        withdrawal({
          status: AccountTransactionStatus.Failed,
          createdAt: new Date(NOW.getTime() + 1000),
        }),
      );
      built.verifier.inspectUsdtTransfer.mockResolvedValue(
        sentToAddress('100'),
      );

      await expect(
        built.service.completeManually(41, HASH, ADMIN),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it.each([WithdrawalAttempt, DepositTransfer])(
      'refuses a hash already used by %p',
      async (entity) => {
        const built = build();
        built.findOneBy.set(AccountTransaction, () =>
          withdrawal({ status: AccountTransactionStatus.Failed }),
        );
        built.verifier.inspectUsdtTransfer.mockResolvedValue(
          sentToAddress('100'),
        );
        built.countBy.set(entity, () => 1);

        await expect(
          built.service.completeManually(41, HASH, ADMIN),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(built.wallets.settleWithdrawalWithin).not.toHaveBeenCalled();
      },
    );

    it('accepts an overpayment and settles the request’s own amount and fee', async () => {
      const built = build();
      const row = withdrawal({ status: AccountTransactionStatus.Failed });
      built.findOneBy.set(AccountTransaction, () => row);
      built.verifier.inspectUsdtTransfer.mockResolvedValue(
        sentToAddress('120'),
      );

      await built.service.completeManually(41, HASH, ADMIN);

      expect(built.manager.create).toHaveBeenCalledWith(WithdrawalAttempt, {
        accountTransactionId: 41,
        outgoingTransferId: null,
        txHash: HASH,
        status: OutgoingTransferStatus.Confirmed,
        amountSent: toCrypto(120),
      });
      expect(built.wallets.settleWithdrawalWithin).toHaveBeenCalledWith(
        built.manager,
        TRADER,
        toCrypto(100),
        toCrypto('0.5'),
        41,
      );
      expect(row).toMatchObject({
        status: AccountTransactionStatus.Completed,
        paidManually: true,
        actorUserId: ADMIN,
        txHash: HASH,
      });
      expect(built.audit.record).toHaveBeenCalledWith(
        {
          actorUserId: ADMIN,
          targetUserId: TRADER,
          action: 'withdrawal.completed_manually',
          metadata: {
            accountTransactionId: 41,
            txHash: HASH,
            amountSent: '120.000000',
          },
        },
        built.manager,
      );
    });
  });
});

describe('WithdrawalsService.payableByHand', () => {
  const service = (mode: string) =>
    new (
      WithdrawalsService as unknown as new (
        ...args: unknown[]
      ) => WithdrawalsService
    )(
      { get: jest.fn(() => mode), getOrThrow: jest.fn() },
      ...Array.from({ length: 9 }, () => ({})),
      { register: jest.fn() },
      {},
    );

  it('allows paying only a failed withdrawal by hand in auto mode, so it cannot race the queue', () => {
    expect(service('auto').payableByHand()).toEqual([
      AccountTransactionStatus.Failed,
    ]);
  });

  it('allows paying a queued withdrawal by hand in manual mode, where nothing else pays it', () => {
    expect(service('manual').payableByHand()).toEqual([
      AccountTransactionStatus.Pending,
      AccountTransactionStatus.Failed,
    ]);
  });
});
