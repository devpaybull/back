import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  And,
  Equal,
  FindOptionsWhere,
  In,
  LessThanOrEqual,
  MoreThan,
  Repository,
} from 'typeorm';
import { Transaction } from '../entities/transaction.entity';
import { StatusEventSource } from '../types/status-event-source.enum';
import { TransactionStatus } from '../types/transaction-status.enum';
import { TICKING_STATUSES } from '../utils/status-transitions';
import { TransactionService } from './transaction.service';

type ExpiryCursor = Pick<Transaction, 'id' | 'expiresAt'>;

const BATCH_SIZE = 100;
const EXPIRED_REASON = 'expired';

@Injectable()
export class DealExpiryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DealExpiryService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @InjectRepository(Transaction)
    private readonly transactions: Repository<Transaction>,
    private readonly transactionService: TransactionService,
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

  async run(now: Date = new Date()): Promise<number> {
    if (this.running) return 0;

    this.running = true;
    let canceled = 0;

    try {
      let batch: ExpiryCursor[];
      let after: ExpiryCursor | null = null;

      do {
        batch = await this.findExpired(now, after);

        for (const { id } of batch) {
          if (await this.expire(id, now)) canceled++;
        }

        after = batch[batch.length - 1] ?? null;
      } while (batch.length === BATCH_SIZE);
    } catch (error) {
      this.logger.error(
        `Deal expiry failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
    } finally {
      this.running = false;
    }

    return canceled;
  }

  private findExpired(
    now: Date,
    after: ExpiryCursor | null,
  ): Promise<ExpiryCursor[]> {
    const ticking = In([...TICKING_STATUSES]);
    const where:
      FindOptionsWhere<Transaction> | FindOptionsWhere<Transaction>[] =
      after?.expiresAt
        ? [
            {
              status: ticking,
              expiresAt: And(MoreThan(after.expiresAt), LessThanOrEqual(now)),
            },
            {
              status: ticking,
              expiresAt: Equal(after.expiresAt),
              id: MoreThan(after.id),
            },
          ]
        : { status: ticking, expiresAt: LessThanOrEqual(now) };

    return this.transactions.find({
      select: { id: true, expiresAt: true },
      where,
      order: { expiresAt: 'ASC', id: 'ASC' },
      take: BATCH_SIZE,
    });
  }

  private async expire(id: string, now: Date): Promise<boolean> {
    try {
      return await this.transactions.manager.transaction(async (manager) => {
        const deal = await manager
          .getRepository(Transaction)
          .createQueryBuilder('transaction')
          .where('transaction.id = :id', { id })
          .andWhere('transaction.status IN (:...statuses)', {
            statuses: TICKING_STATUSES,
          })
          .andWhere('transaction.expiresAt <= :now', { now })
          .setLock('pessimistic_write')
          .setOnLocked('skip_locked')
          .getOne();

        if (!deal) return false;

        await this.transactionService.transitionLocked(manager, deal, {
          toStatus: TransactionStatus.Canceled,
          source: StatusEventSource.AutoTimer,
          actorUserId: null,
          reason: EXPIRED_REASON,
        });

        return true;
      });
    } catch (error) {
      this.logger.error(
        `Expiring deal ${id} failed: ${(error as Error).message}`,
        (error as Error).stack,
      );

      return false;
    }
  }
}
