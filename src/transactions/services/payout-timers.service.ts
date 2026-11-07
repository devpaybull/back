import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, LessThanOrEqual, MoreThan, Repository } from 'typeorm';
import { Transaction } from '../entities/transaction.entity';
import { PayoutDeclineKind } from '../types/payout-decline-kind.enum';
import { StatusEventSource } from '../types/status-event-source.enum';
import { TransactionKind } from '../types/transaction-kind.enum';
import { TransactionStatus } from '../types/transaction-status.enum';
import { TraderPayoutActionsService } from './trader-payout-actions.service';
import { TransactionService } from './transaction.service';

const BATCH_SIZE = 100;
const MINUTE_MS = 60_000;
const REVIEWED_REASON = 'review_window_passed';

@Injectable()
export class PayoutTimersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PayoutTimersService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @InjectRepository(Transaction)
    private readonly transactions: Repository<Transaction>,
    private readonly transactionService: TransactionService,
    private readonly actions: TraderPayoutActionsService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const seconds = this.config.get<number>('DEAL_EXPIRY_INTERVAL_SECONDS');

    this.timer = setInterval(() => void this.run(), seconds * 1000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async run(now: Date = new Date()): Promise<void> {
    if (this.running) return;

    this.running = true;

    try {
      await this.drain(
        (afterId) => this.findOverdue(now, afterId),
        (manager, deal) => this.returnOverdue(manager, deal, now),
      );
      await this.drain(
        (afterId) => this.findReviewed(now, afterId),
        (manager, deal) => this.settleReviewed(manager, deal, now),
      );
    } catch (error) {
      this.logger.error(
        `Pay-out timers failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
    } finally {
      this.running = false;
    }
  }

  private async drain(
    find: (afterId: string | null) => Promise<Pick<Transaction, 'id'>[]>,
    apply: (manager: EntityManager, deal: Transaction) => Promise<boolean>,
  ): Promise<void> {
    let batch: Pick<Transaction, 'id'>[];
    let afterId: string | null = null;

    do {
      batch = await find(afterId);

      for (const { id } of batch) await this.applyOne(id, apply);

      afterId = batch[batch.length - 1]?.id ?? null;
    } while (batch.length === BATCH_SIZE);
  }

  private async applyOne(
    id: string,
    apply: (manager: EntityManager, deal: Transaction) => Promise<boolean>,
  ): Promise<boolean> {
    try {
      return await this.transactions.manager.transaction(async (manager) => {
        const deal = await manager
          .getRepository(Transaction)
          .createQueryBuilder('transaction')
          .where('transaction.id = :id', { id })
          .setLock('pessimistic_write')
          .setOnLocked('skip_locked')
          .getOne();

        return deal ? apply(manager, deal) : false;
      });
    } catch (error) {
      this.logger.error(
        `Pay-out timer on ${id} failed: ${(error as Error).message}`,
        (error as Error).stack,
      );

      return false;
    }
  }

  private findOverdue(
    now: Date,
    afterId: string | null,
  ): Promise<Pick<Transaction, 'id'>[]> {
    return this.transactions.find({
      select: { id: true },
      where: {
        kind: TransactionKind.PayOut,
        status: TransactionStatus.Active,
        payoutDeadlineAt: LessThanOrEqual(now),
        ...(afterId ? { id: MoreThan(afterId) } : {}),
      },
      order: { id: 'ASC' },
      take: BATCH_SIZE,
    });
  }

  private findReviewed(
    now: Date,
    afterId: string | null,
  ): Promise<Pick<Transaction, 'id'>[]> {
    return this.transactions.find({
      select: { id: true },
      where: {
        kind: TransactionKind.PayOut,
        status: TransactionStatus.Checking,
        payoutCompletedAt: LessThanOrEqual(this.reviewCutoff(now)),
        ...(afterId ? { id: MoreThan(afterId) } : {}),
      },
      order: { id: 'ASC' },
      take: BATCH_SIZE,
    });
  }

  private reviewCutoff(now: Date): Date {
    return new Date(
      now.getTime() -
        this.config.getOrThrow<number>('PAYOUT_REVIEW_MINUTES') * MINUTE_MS,
    );
  }

  private async returnOverdue(
    manager: EntityManager,
    deal: Transaction,
    now: Date,
  ): Promise<boolean> {
    if (
      deal.status !== TransactionStatus.Active ||
      !deal.payoutDeadlineAt ||
      deal.payoutDeadlineAt.getTime() > now.getTime()
    ) {
      return false;
    }

    await this.actions.releaseToPoolWithin(manager, deal, {
      kind: PayoutDeclineKind.Expired,
      reasonCode: null,
      comment: null,
      source: StatusEventSource.AutoTimer,
      actorUserId: null,
    });

    return true;
  }

  private async settleReviewed(
    manager: EntityManager,
    deal: Transaction,
    now: Date,
  ): Promise<boolean> {
    if (
      deal.status !== TransactionStatus.Checking ||
      !deal.payoutCompletedAt ||
      deal.payoutCompletedAt.getTime() > this.reviewCutoff(now).getTime()
    ) {
      return false;
    }

    await this.transactionService.transitionLocked(manager, deal, {
      toStatus: TransactionStatus.Success,
      source: StatusEventSource.AutoTimer,
      actorUserId: null,
      reason: REVIEWED_REASON,
    });

    return true;
  }
}
