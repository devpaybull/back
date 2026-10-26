import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, MoreThan, Not } from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { ActivityAction } from '../../audit/types/activity-action.enum';
import { Crypto } from '../../common/types/crypto';
import { formatCrypto } from '../../common/utils/format-crypto';
import { roundCrypto } from '../../common/utils/round-crypto';
import { toCrypto } from '../../common/utils/to-crypto';
import { toDecimal } from '../../common/utils/to-decimal';
import { WalletService } from '../../transactions/services/wallet.service';
import { TronOutgoingTransfer } from '../../tron/entities/tron-outgoing-transfer.entity';
import { EnergyManager } from '../../tron/services/energy-manager.service';
import { TronConfirmationTracker } from '../../tron/services/tron-confirmation-tracker.service';
import { TronKeyring } from '../../tron/services/tron-keyring.service';
import { TronSender } from '../../tron/services/tron-sender.service';
import { TronVerifier } from '../../tron/services/tron-verifier.service';
import { AddressPurpose } from '../../tron/types/address-purpose.enum';
import { OutgoingTransferStatus } from '../../tron/types/outgoing-transfer-status.enum';
import { isTronAddress } from '../../tron/utils/is-tron-address';
import { UserCredentialsService } from '../../users/services/user-credentials.service';
import { UserDirectoryService } from '../../users/services/user-directory.service';
import { AccountTransaction } from '../entities/account-transaction.entity';
import { DepositAddress } from '../entities/deposit-address.entity';
import { DepositTransfer } from '../entities/deposit-transfer.entity';
import { WithdrawalAttempt } from '../entities/withdrawal-attempt.entity';
import { WithdrawalQuote } from '../entities/withdrawal-quote.entity';
import { AccountTransactionStatus } from '../types/account-transaction-status.enum';
import { AccountTransactionStatusReason } from '../types/account-transaction-status-reason.enum';
import { AccountTransactionType } from '../types/account-transaction-type.enum';
import { FeeChangedException } from '../types/fee-changed.error';
import { WithdrawalQuoteResult } from '../types/withdrawal-quote-result';
import { WithdrawalRequestInput } from '../types/withdrawal-request-input';
import { WithdrawalVerification } from '../types/withdrawal-verification';
import { WITHDRAWAL_KEY_PREFIX } from '../utils/withdrawal-key-prefix';
import { TransfersService } from './transfers.service';

const INVALID_TOTP = 'Invalid login, password or one-time code';
const DAY_MS = 86_400_000;

type Destination =
  { kind: 'external' } | { kind: 'internal'; recipientUserId: string };

@Injectable()
export class WithdrawalsService {
  private readonly logger = new Logger(WithdrawalsService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly wallets: WalletService,
    private readonly audit: AuditService,
    private readonly energy: EnergyManager,
    private readonly keyring: TronKeyring,
    private readonly verifier: TronVerifier,
    private readonly sender: TronSender,
    private readonly credentials: UserCredentialsService,
    private readonly directory: UserDirectoryService,
    private readonly transfers: TransfersService,
    tracker: TronConfirmationTracker,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {
    tracker.register(WITHDRAWAL_KEY_PREFIX, (manager, transfer) =>
      this.onAttemptFinal(manager, transfer),
    );
  }

  async quote(
    userId: string,
    address: string,
    amount: Crypto,
    now = new Date(),
  ): Promise<WithdrawalQuoteResult> {
    const destination = await this.destinationOf(userId, address);
    const wallet = await this.wallets.findByUserId(userId);
    const available = wallet
      ? this.wallets.getAvailableMain(wallet)
      : toCrypto(0);
    const fee =
      destination.kind === 'internal'
        ? { usdt: toCrypto(0), trx: toCrypto(0) }
        : await this.energy.quoteUsdtTransferFee(
            await this.keyring.hotAddress(),
            address,
            amount,
          );
    const expiresAt = new Date(
      now.getTime() +
        this.config.getOrThrow<number>('WITHDRAWAL_QUOTE_TTL_SECONDS') * 1000,
    );

    await this.dataSource.getRepository(WithdrawalQuote).save({
      userId,
      address,
      amount,
      fee: fee.usdt,
      feeTrx: fee.trx,
      expiresAt,
    });

    const max = roundCrypto(available.minus(fee.usdt));

    return {
      available,
      fee,
      maxAmount: max.isNegative() ? toCrypto(0) : max,
      internal: destination.kind === 'internal',
      expiresAt,
    };
  }

  async request(
    input: WithdrawalRequestInput,
    now = new Date(),
  ): Promise<AccountTransaction> {
    const user = await this.directory.requireById(input.userId);

    const code = await this.credentials.spendWithdrawalTotp(
      user,
      input.totp,
      {
        maxFailures: this.config.get<number>('WITHDRAWAL_TOTP_MAX_FAILURES', 5),
        windowMinutes: this.config.get<number>(
          'WITHDRAWAL_TOTP_LOCK_MINUTES',
          15,
        ),
      },
      now,
    );

    if (code !== 'accepted') {
      await this.audit.record({
        actorUserId: input.userId,
        targetUserId: input.userId,
        action: 'withdrawal.totp_refused',
        metadata: { locked: code === 'locked' },
      });

      if (code === 'locked') {
        throw new HttpException(
          'Too many wrong codes; withdrawals are locked for a while',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      throw new UnauthorizedException(INVALID_TOTP);
    }

    this.assertSecurityHoldOver(
      [user.passwordChangedAt, user.twoFactorResetAt],
      now,
    );

    const destination = await this.destinationOf(input.userId, input.address);

    if (input.amount.lt(this.minimum())) {
      throw new BadRequestException(
        `The amount is below the minimum withdrawal of ${formatCrypto(this.minimum())} USDT`,
      );
    }

    if (destination.kind === 'internal') {
      return this.transfers.transfer(
        {
          fromUserId: input.userId,
          toUserId: destination.recipientUserId,
          amount: input.amount,
          actorUserId: input.userId,
          comment: `Withdrawal to the deposit address ${input.address}`,
        },
        (manager) => this.lockAndCheckDailyLimit(manager, input, now),
      );
    }

    const fee = await this.liveFee(input, now);

    return this.dataSource.transaction(async (manager) => {
      await this.lockAndCheckDailyLimit(manager, input, now);
      await this.wallets.reserveMainEscrowWithin(
        manager,
        input.userId,
        roundCrypto(input.amount.plus(fee)),
      );
      const row = await manager.save(
        manager.create(AccountTransaction, {
          type: AccountTransactionType.Withdrawal,
          status: AccountTransactionStatus.Pending,
          statusReason: null,
          userId: input.userId,
          amount: input.amount,
          fee,
          address: input.address,
          paidManually: false,
        }),
      );
      await this.audit.record(
        {
          actorUserId: input.userId,
          targetUserId: input.userId,
          action: 'withdrawal.requested',
          metadata: {
            accountTransactionId: row.id,
            address: input.address,
            amount: formatCrypto(input.amount),
            fee: formatCrypto(fee),
          },
        },
        manager,
      );

      return row;
    });
  }

  async findById(id: number): Promise<AccountTransaction | null> {
    return this.dataSource.getRepository(AccountTransaction).findOne({
      where: { id, type: AccountTransactionType.Withdrawal },
    });
  }

  async findOwn(id: number, userId: string): Promise<AccountTransaction> {
    const row = await this.dataSource
      .getRepository(AccountTransaction)
      .findOne({
        where: { id, userId, type: AccountTransactionType.Withdrawal },
      });

    if (!row) throw new NotFoundException('Withdrawal not found');

    return row;
  }

  cancelOwn(id: number, userId: string): Promise<AccountTransaction> {
    return this.release(
      id,
      [AccountTransactionStatus.Pending],
      AccountTransactionStatusReason.CanceledByUser,
      userId,
      { userId },
    );
  }

  reject(
    id: number,
    actorUserId: string,
    reason: string,
  ): Promise<AccountTransaction> {
    return this.release(
      id,
      [AccountTransactionStatus.Pending, AccountTransactionStatus.Failed],
      AccountTransactionStatusReason.RejectedByAdmin,
      actorUserId,
      {},
      reason,
    );
  }

  async verifyPayment(
    id: number,
    txHash: string,
  ): Promise<WithdrawalVerification> {
    const row = await this.findById(id);

    if (!row) throw new NotFoundException('Withdrawal not found');

    const inspection = await this.verifier.inspectUsdtTransfer(txHash);
    const sent = this.sentTo(row, inspection.transfers);
    const refusal = await this.paymentRefusal(
      row,
      inspection.status,
      sent,
      txHash,
    );

    return {
      inspection,
      completable: refusal === null,
      amountSent: sent ? formatCrypto(sent) : null,
      reason: refusal?.message ?? null,
    };
  }

  async completeManually(
    id: number,
    txHash: string,
    actorUserId: string,
  ): Promise<AccountTransaction> {
    const inspection = await this.verifier.inspectUsdtTransfer(txHash);

    return this.dataSource.transaction(async (manager) => {
      const row = await manager.findOne(AccountTransaction, {
        where: { id, type: AccountTransactionType.Withdrawal },
        lock: { mode: 'pessimistic_write' },
      });

      if (!row) throw new NotFoundException('Withdrawal not found');

      const sent = this.sentTo(row, inspection.transfers);
      const refusal = await this.paymentRefusal(
        row,
        inspection.status,
        sent,
        txHash,
        manager,
      );

      if (refusal) throw refusal;

      await manager.save(
        manager.create(WithdrawalAttempt, {
          accountTransactionId: row.id,
          outgoingTransferId: null,
          txHash,
          status: OutgoingTransferStatus.Confirmed,
          amountSent: sent,
        }),
      );
      row.paidManually = true;
      row.actorUserId = actorUserId;
      const completed = await this.complete(manager, row, txHash);
      await this.audit.record(
        {
          actorUserId,
          targetUserId: row.userId,
          action: 'withdrawal.completed_manually',
          metadata: {
            accountTransactionId: row.id,
            txHash,
            amountSent: formatCrypto(sent!),
          },
        },
        manager,
      );

      return completed;
    });
  }

  async onAttemptFinal(
    manager: EntityManager,
    transfer: TronOutgoingTransfer,
  ): Promise<void> {
    const [, rowId, attemptId] = transfer.idempotencyKey.split(':');
    const attempt = await manager.findOne(WithdrawalAttempt, {
      where: { id: Number(attemptId), accountTransactionId: Number(rowId) },
    });

    if (!attempt) return;

    attempt.outgoingTransferId = transfer.id;
    attempt.status = transfer.status;
    attempt.txHash = transfer.txHash;
    await manager.save(attempt);

    const row = await manager.findOne(AccountTransaction, {
      where: { id: attempt.accountTransactionId },
      lock: { mode: 'pessimistic_write' },
    });

    if (!row || row.status !== AccountTransactionStatus.Processing) return;

    if (transfer.status === OutgoingTransferStatus.Confirmed) {
      await this.complete(manager, row, transfer.txHash);
      return;
    }

    row.status = AccountTransactionStatus.Failed;
    row.statusReason = AccountTransactionStatusReason.NetworkFailed;
    await manager.save(row);
    this.logger.warn(
      `Withdrawal ${row.id} failed in the network: ${transfer.failureReason ?? transfer.status}`,
    );
  }

  private async complete(
    manager: EntityManager,
    row: AccountTransaction,
    txHash: string | null,
  ): Promise<AccountTransaction> {
    await this.wallets.settleWithdrawalWithin(
      manager,
      row.userId,
      row.amount!,
      row.fee ?? toCrypto(0),
      row.id,
    );
    row.status = AccountTransactionStatus.Completed;
    row.statusReason = null;
    row.txHash = txHash;
    row.completedAt = new Date();
    const saved = await manager.save(row);
    const metadata = {
      accountTransactionId: row.id,
      txHash,
      amount: formatCrypto(row.amount!),
      fee: formatCrypto(row.fee ?? toCrypto(0)),
    };

    await this.audit.record(
      {
        actorUserId: row.actorUserId,
        targetUserId: row.userId,
        action: 'withdrawal.completed',
        metadata,
      },
      manager,
    );
    await this.audit.record(
      {
        actorUserId: row.actorUserId,
        targetUserId: row.userId,
        action: ActivityAction.WithdrawalCompleted,
        metadata,
      },
      manager,
    );

    return saved;
  }

  private release(
    id: number,
    from: AccountTransactionStatus[],
    reason: AccountTransactionStatusReason,
    actorUserId: string,
    scope: { userId?: string },
    comment: string | null = null,
  ): Promise<AccountTransaction> {
    return this.dataSource.transaction(async (manager) => {
      const row = await manager.findOne(AccountTransaction, {
        where: { id, type: AccountTransactionType.Withdrawal, ...scope },
        lock: { mode: 'pessimistic_write' },
      });

      if (!row) throw new NotFoundException('Withdrawal not found');

      if (!from.includes(row.status)) {
        throw new ConflictException(
          `A ${row.status} withdrawal cannot be canceled`,
        );
      }

      await this.wallets.releaseEscrowWithin(
        manager,
        row.userId,
        roundCrypto(row.amount!.plus(row.fee ?? toCrypto(0))),
      );
      row.status = AccountTransactionStatus.Canceled;
      row.statusReason = reason;
      row.comment = comment ?? row.comment;

      if (reason === AccountTransactionStatusReason.RejectedByAdmin) {
        row.actorUserId = actorUserId;
      }

      const saved = await manager.save(row);
      await this.audit.record(
        {
          actorUserId,
          targetUserId: row.userId,
          action:
            reason === AccountTransactionStatusReason.RejectedByAdmin
              ? 'withdrawal.rejected'
              : 'withdrawal.canceled',
          reason: comment,
          metadata: { accountTransactionId: row.id },
        },
        manager,
      );

      return saved;
    });
  }

  private sentTo(
    row: AccountTransaction,
    transfers: { to: string; amount: Crypto; blockTime: Date }[],
  ): Crypto | null {
    const matching = transfers.filter(
      (transfer) =>
        transfer.to === row.address && transfer.blockTime >= row.createdAt,
    );

    if (matching.length === 0) return null;

    return roundCrypto(
      matching.reduce(
        (total, transfer) => total.plus(transfer.amount),
        toDecimal(0),
      ),
    );
  }

  private async paymentRefusal(
    row: AccountTransaction,
    status: string,
    sent: Crypto | null,
    txHash: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<Error | null> {
    if (status === 'not_found' || status === 'pending') {
      return new ConflictException('The transaction is not confirmed yet');
    }

    if (status === 'failed' || status === 'not_usdt') {
      return new BadRequestException(
        'The transaction is not a successful USDT transfer',
      );
    }

    if (!sent) {
      return new BadRequestException(
        'The transfer did not go to the address of this withdrawal',
      );
    }

    if (sent.lt(row.amount!)) {
      return new BadRequestException(
        'The transfer is smaller than the amount of this withdrawal',
      );
    }

    if (!this.payableByHand().includes(row.status)) {
      return new ConflictException(
        `A ${row.status} withdrawal cannot be closed by hand`,
      );
    }

    const [attempts, outgoing, deposits] = await Promise.all([
      manager.count(WithdrawalAttempt, {
        where: { txHash, accountTransactionId: Not(row.id) },
      }),
      this.sender.isHashUsedOutside(
        txHash,
        `${WITHDRAWAL_KEY_PREFIX}:${row.id}:`,
      ),
      manager.count(DepositTransfer, { where: { txHash } }),
    ]);

    return attempts > 0 || outgoing || deposits > 0
      ? new ConflictException('This transaction hash is already used')
      : null;
  }

  private async destinationOf(
    userId: string,
    address: string,
  ): Promise<Destination> {
    if (!isTronAddress(address)) {
      throw new BadRequestException('The address is not a valid Tron address');
    }

    const platform = await this.keyring.findAddress(address);

    if (!platform) return { kind: 'external' };

    if (platform.purpose !== AddressPurpose.Deposit) {
      throw new BadRequestException(
        'Withdrawals to a platform wallet are refused',
      );
    }

    const owner = await this.dataSource.getRepository(DepositAddress).findOne({
      where: { tronAddressId: platform.id },
    });

    if (!owner || owner.userId === userId) {
      throw new BadRequestException(
        'Withdrawals to your own deposit address are refused',
      );
    }

    return { kind: 'internal', recipientUserId: owner.userId };
  }

  private async liveFee(
    input: WithdrawalRequestInput,
    now: Date,
  ): Promise<Crypto> {
    const quotes = await this.dataSource.getRepository(WithdrawalQuote).find({
      where: {
        userId: input.userId,
        address: input.address,
        expiresAt: MoreThan(now),
      },
      order: { id: 'DESC' },
      take: 20,
    });
    const quote = quotes.find((candidate) => candidate.amount.eq(input.amount));

    if (quote) return quote.fee;

    const fresh = await this.quote(
      input.userId,
      input.address,
      input.amount,
      now,
    );
    throw new FeeChangedException(formatCrypto(fresh.fee.usdt));
  }

  private async lockAndCheckDailyLimit(
    manager: EntityManager,
    input: WithdrawalRequestInput,
    now: Date,
  ): Promise<void> {
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `withdrawals:${input.userId}`,
    ]);
    await this.assertDailyLimit(manager, input.userId, input.amount, now);
  }

  private async assertDailyLimit(
    manager: EntityManager,
    userId: string,
    amount: Crypto,
    now: Date,
  ): Promise<void> {
    const since = MoreThan(new Date(now.getTime() - DAY_MS));
    const recent = await manager.find(AccountTransaction, {
      where: [
        {
          type: AccountTransactionType.Withdrawal,
          userId,
          status: Not(In([AccountTransactionStatus.Canceled])),
          createdAt: since,
        },
        {
          type: AccountTransactionType.Transfer,
          userId,
          actorUserId: userId,
          createdAt: since,
        },
      ],
    });
    const total = recent.reduce(
      (sum, row) => sum.plus(row.amount ?? 0),
      toDecimal(amount),
    );
    const limit = toCrypto(
      this.config.getOrThrow<string>('WITHDRAWAL_DAILY_LIMIT_USDT'),
    );

    if (total.gt(limit)) {
      throw new ConflictException(
        `The 24-hour withdrawal limit of ${formatCrypto(limit)} USDT would be exceeded`,
      );
    }
  }

  private assertSecurityHoldOver(changes: (Date | null)[], now: Date): void {
    const holdMs =
      this.config.getOrThrow<number>('WITHDRAWAL_SECURITY_HOLD_HOURS') *
      3_600_000;
    const recent = changes.some(
      (changedAt) => changedAt && now.getTime() - changedAt.getTime() < holdMs,
    );

    if (recent) {
      throw new ConflictException(
        'Withdrawals are on hold after a password change or a second-factor reset',
      );
    }
  }

  payableByHand(): AccountTransactionStatus[] {
    return this.config.get<string>('PAYOUT_MODE') === 'manual'
      ? [AccountTransactionStatus.Pending, AccountTransactionStatus.Failed]
      : [AccountTransactionStatus.Failed];
  }

  private minimum(): Crypto {
    return toCrypto(this.config.getOrThrow<string>('WITHDRAWAL_MIN_USDT'));
  }
}
