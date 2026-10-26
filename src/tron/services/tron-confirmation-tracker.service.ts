import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, LessThan } from 'typeorm';
import { TronOutgoingTransfer } from '../entities/tron-outgoing-transfer.entity';
import { OutgoingTransferHandler } from '../types/outgoing-transfer-handler';
import { OutgoingTransferStatus } from '../types/outgoing-transfer-status.enum';
import { TronTransactionInfo } from '../types/tron-transaction-info';
import { isFinalOutgoingStatus } from '../utils/is-final-outgoing-status';
import { isSuccessfulTransaction } from '../utils/is-successful-transaction';
import { TronNodeClient } from './tron-node.client';

const BATCH_SIZE = 100;
const EXPIRY_MARGIN_MS = 300_000;
const ABANDONED_BUILD_MS = 600_000;

@Injectable()
export class TronConfirmationTracker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TronConfirmationTracker.name);
  private readonly handlers = new Map<string, OutgoingTransferHandler>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly node: TronNodeClient,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  register(keyPrefix: string, handler: OutgoingTransferHandler): void {
    this.handlers.set(keyPrefix, handler);
  }

  onModuleInit(): void {
    const seconds = this.config.get<number>(
      'TRON_CONFIRM_INTERVAL_SECONDS',
      10,
    );
    this.timer = setInterval(() => void this.tick(), seconds * 1000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(now = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;

    try {
      return await this.run(now);
    } catch (error) {
      this.logger.error(`Confirmation run failed: ${(error as Error).message}`);
      return 0;
    } finally {
      this.running = false;
    }
  }

  async run(now: Date): Promise<number> {
    const abandoned = await this.dataSource
      .getRepository(TronOutgoingTransfer)
      .find({
        where: {
          status: OutgoingTransferStatus.Building,
          createdAt: LessThan(new Date(now.getTime() - ABANDONED_BUILD_MS)),
        },
        take: BATCH_SIZE,
      });

    for (const transfer of abandoned) {
      await this.finalize(transfer.id, {
        status: OutgoingTransferStatus.Failed,
        info: null,
        reason: 'abandoned while building, never signed',
      });
    }

    const pending = await this.dataSource
      .getRepository(TronOutgoingTransfer)
      .find({
        where: {
          status: In([
            OutgoingTransferStatus.Signed,
            OutgoingTransferStatus.Broadcast,
          ]),
        },
        order: { id: 'ASC' },
        take: BATCH_SIZE,
      });
    let finalized = abandoned.length;

    for (const transfer of pending) {
      const outcome = await this.outcomeOf(transfer, now);

      if (!outcome) continue;

      if (await this.finalize(transfer.id, outcome)) finalized += 1;
    }

    return finalized;
  }

  private async outcomeOf(
    transfer: TronOutgoingTransfer,
    now: Date,
  ): Promise<{
    status: OutgoingTransferStatus;
    info: TronTransactionInfo | null;
  } | null> {
    if (!transfer.txHash) return null;

    const info = await this.node.getSolidifiedTransactionInfo(transfer.txHash);

    if (info) {
      return {
        status: isSuccessfulTransaction(info)
          ? OutgoingTransferStatus.Confirmed
          : OutgoingTransferStatus.Failed,
        info,
      };
    }

    const expired =
      transfer.expiresAt !== null &&
      transfer.expiresAt.getTime() + EXPIRY_MARGIN_MS < now.getTime();

    if (!expired) return null;

    const [known, solidified] = await Promise.all([
      this.node.getTransaction(transfer.txHash),
      this.node.getSolidifiedTransactionInfo(transfer.txHash),
    ]);

    return known || solidified
      ? null
      : { status: OutgoingTransferStatus.Expired, info: null };
  }

  private finalize(
    id: number,
    outcome: {
      status: OutgoingTransferStatus;
      info: TronTransactionInfo | null;
      reason?: string;
    },
  ): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const transfer = await manager.findOne(TronOutgoingTransfer, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });

      if (!transfer || isFinalOutgoingStatus(transfer.status)) return false;

      const { info } = outcome;
      transfer.status = outcome.status;

      if (info) {
        transfer.blockNumber = String(info.blockNumber ?? '') || null;
        transfer.energyUsed = String(info.receipt?.energy_usage_total ?? 0);
        transfer.energyFromStake = String(info.receipt?.energy_usage ?? 0);
        transfer.trxBurnedSun = String(info.fee ?? 0);
        transfer.bandwidthUsed = String(info.receipt?.net_usage ?? 0);
        transfer.confirmedAt = new Date(info.blockTimeStamp ?? Date.now());
      }

      if (outcome.status === OutgoingTransferStatus.Failed) {
        transfer.failureReason =
          outcome.reason ??
          info?.receipt?.result ??
          info?.resMessage ??
          'FAILED';
      }

      if (outcome.status === OutgoingTransferStatus.Expired) {
        transfer.failureReason = 'expired without reaching the network';
      }

      await manager.save(transfer);

      const handler = this.handlers.get(transfer.idempotencyKey.split(':')[0]);
      if (handler) await handler(manager, transfer);

      return true;
    });
  }
}
