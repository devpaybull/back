import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull } from 'typeorm';
import { Crypto } from '../../common/types/crypto';
import { roundCrypto } from '../../common/utils/round-crypto';
import { toDecimal } from '../../common/utils/to-decimal';
import { TronOutgoingTransfer } from '../../tron/entities/tron-outgoing-transfer.entity';
import { EnergyManager } from '../../tron/services/energy-manager.service';
import { TronKeyring } from '../../tron/services/tron-keyring.service';
import { TronVerifier } from '../../tron/services/tron-verifier.service';
import { TronSender } from '../../tron/services/tron-sender.service';
import { OutgoingTransferStatus } from '../../tron/types/outgoing-transfer-status.enum';
import { TronUnavailableError } from '../../tron/types/tron-unavailable.error';
import { isFinalOutgoingStatus } from '../../tron/utils/is-final-outgoing-status';
import { AccountTransaction } from '../entities/account-transaction.entity';
import { WithdrawalAttempt } from '../entities/withdrawal-attempt.entity';
import { AccountTransactionStatus } from '../types/account-transaction-status.enum';
import { AccountTransactionStatusReason } from '../types/account-transaction-status-reason.enum';
import { AccountTransactionType } from '../types/account-transaction-type.enum';
import { WITHDRAWAL_KEY_PREFIX } from '../utils/withdrawal-key-prefix';
import { WithdrawalsService } from './withdrawals.service';

@Injectable()
export class PayoutQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PayoutQueueService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly sender: TronSender,
    private readonly keyring: TronKeyring,
    private readonly verifier: TronVerifier,
    private readonly energy: EnergyManager,
    private readonly withdrawals: WithdrawalsService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  get isAuto(): boolean {
    return this.config.get<string>('PAYOUT_MODE') === 'auto';
  }

  onModuleInit(): void {
    const seconds = this.config.get<number>('PAYOUT_INTERVAL_SECONDS', 15);
    this.timer = setInterval(() => void this.tick(), seconds * 1000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;

    try {
      await this.resumeUnsent();
      return this.isAuto ? await this.run() : 0;
    } catch (error) {
      this.logger.error(`Payout run failed: ${(error as Error).message}`);
      return 0;
    } finally {
      this.running = false;
    }
  }

  async run(): Promise<number> {
    const queued = await this.dataSource
      .getRepository(AccountTransaction)
      .find({
        where: {
          type: AccountTransactionType.Withdrawal,
          status: AccountTransactionStatus.Pending,
        },
        order: { createdAt: 'ASC', id: 'ASC' },
        take: this.config.get<number>('PAYOUT_BATCH_SIZE', 10),
      });
    let sent = 0;
    let committed = await this.inFlightAmount();

    for (const candidate of queued) {
      if (!(await this.canPay(candidate, committed))) break;

      committed = roundCrypto(committed.plus(candidate.amount!));

      const attempt = await this.claim(candidate.id);

      if (!attempt) continue;

      await this.send(candidate, attempt);
      sent += 1;
    }

    return sent;
  }

  private async inFlightAmount(): Promise<Crypto> {
    const processing = await this.dataSource
      .getRepository(AccountTransaction)
      .find({
        where: {
          type: AccountTransactionType.Withdrawal,
          status: AccountTransactionStatus.Processing,
        },
      });

    return roundCrypto(
      processing.reduce((sum, row) => sum.plus(row.amount ?? 0), toDecimal(0)),
    );
  }

  private async canPay(
    row: AccountTransaction,
    committed: Crypto,
  ): Promise<boolean> {
    const hot = await this.keyring.hotAddress();
    const balance = await this.verifier.usdtBalanceOf(hot);

    if (balance.minus(committed).lt(row.amount!)) {
      this.logger.warn(
        `The hot wallet holds ${balance.toFixed(6)} USDT, not enough for withdrawal ${row.id}`,
      );
      return false;
    }

    const cost = await this.energy.estimateUsdtTransfer(
      hot,
      row.address!,
      row.amount!,
    );

    if (!(await this.energy.canPayFrom(hot, cost))) {
      this.logger.warn(
        `The hot wallet has neither the energy nor the TRX for withdrawal ${row.id}`,
      );
      return false;
    }

    return true;
  }

  private claim(id: number): Promise<WithdrawalAttempt | null> {
    return this.dataSource.transaction(async (manager) => {
      const row = await manager
        .getRepository(AccountTransaction)
        .createQueryBuilder('entry')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .where('entry.id = :id', { id })
        .andWhere('entry.status = :status', {
          status: AccountTransactionStatus.Pending,
        })
        .getOne();

      if (!row) return null;

      row.status = AccountTransactionStatus.Processing;
      await manager.save(row);

      return manager.save(
        manager.create(WithdrawalAttempt, {
          accountTransactionId: row.id,
          outgoingTransferId: null,
          txHash: null,
          status: OutgoingTransferStatus.Building,
          amountSent: row.amount,
        }),
      );
    });
  }

  private async send(
    row: AccountTransaction,
    attempt: WithdrawalAttempt,
  ): Promise<void> {
    const idempotencyKey = this.keyOf(row.id, attempt.id);

    try {
      await this.link(
        attempt,
        await this.sender.sendUsdt({
          idempotencyKey,
          from: { kind: 'hot' },
          to: row.address!,
          amount: row.amount!,
        }),
      );
    } catch (error) {
      const outgoing = await this.sender.findByKey(idempotencyKey);

      if (outgoing?.txHash) {
        await this.link(attempt, outgoing);
        return;
      }

      await this.unclaim(row.id, attempt.id, error as Error);
    }
  }

  private async resumeUnsent(): Promise<void> {
    const unlinked = await this.dataSource
      .getRepository(WithdrawalAttempt)
      .find({
        where: {
          outgoingTransferId: IsNull(),
          status: OutgoingTransferStatus.Building,
        },
        relations: { accountTransaction: true },
        take: 50,
      });

    for (const attempt of unlinked) {
      const row = attempt.accountTransaction;

      if (row.status !== AccountTransactionStatus.Processing) continue;

      const outgoing = await this.sender.findByKey(
        this.keyOf(row.id, attempt.id),
      );

      if (outgoing?.txHash) {
        await this.link(attempt, outgoing);
      } else if (this.isAuto) {
        await this.send(row, attempt);
      } else {
        await this.unclaim(
          row.id,
          attempt.id,
          new TronUnavailableError('unsent while payouts are manual'),
        );
      }
    }
  }

  private async link(
    attempt: WithdrawalAttempt,
    transfer: TronOutgoingTransfer,
  ): Promise<void> {
    if (transfer.status === OutgoingTransferStatus.Failed && !transfer.txHash) {
      await this.unclaim(
        attempt.accountTransactionId,
        attempt.id,
        new Error(transfer.failureReason ?? 'not sent'),
      );
      return;
    }

    await this.dataSource.getRepository(WithdrawalAttempt).update(attempt.id, {
      outgoingTransferId: transfer.id,
      txHash: transfer.txHash,
      status: transfer.status,
    });

    if (isFinalOutgoingStatus(transfer.status)) {
      await this.dataSource.transaction((manager) =>
        this.withdrawals.onAttemptFinal(manager, transfer),
      );
    }
  }

  private keyOf(rowId: number, attemptId: number): string {
    return `${WITHDRAWAL_KEY_PREFIX}:${rowId}:${attemptId}`;
  }

  private async unclaim(
    id: number,
    attemptId: number,
    error: Error,
  ): Promise<void> {
    const transient = error instanceof TronUnavailableError;

    await this.dataSource.transaction(async (manager) => {
      await manager.update(WithdrawalAttempt, attemptId, {
        status: OutgoingTransferStatus.Failed,
        txHash: null,
      });
      const row = await manager.findOne(AccountTransaction, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });

      if (!row || row.status !== AccountTransactionStatus.Processing) return;

      row.status = transient
        ? AccountTransactionStatus.Pending
        : AccountTransactionStatus.Failed;
      row.statusReason = transient
        ? null
        : AccountTransactionStatusReason.Error;
      await manager.save(row);
    });

    this.logger.warn(`Withdrawal ${id} was not sent: ${error.message}`);
  }
}
