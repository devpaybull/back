import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, MoreThan, Repository } from 'typeorm';
import { TransactionDispute } from '../entities/transaction-dispute.entity';
import { DisputeStatus } from '../types/dispute-status.enum';
import { DisputesService } from './disputes.service';

const BATCH_SIZE = 100;

@Injectable()
export class DisputeDeadlineService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DisputeDeadlineService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @InjectRepository(TransactionDispute)
    private readonly disputes: Repository<TransactionDispute>,
    private readonly service: DisputesService,
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
    let escalated = 0;

    try {
      let afterId = 0;
      let batch: Pick<TransactionDispute, 'id'>[];

      do {
        batch = await this.disputes.find({
          select: { id: true },
          where: {
            status: DisputeStatus.Open,
            traderDeadlineAt: LessThanOrEqual(now),
            id: MoreThan(afterId),
          },
          order: { id: 'ASC' },
          take: BATCH_SIZE,
        });

        for (const { id } of batch) {
          if (await this.escalateOne(id, now)) escalated++;
        }

        afterId = batch[batch.length - 1]?.id ?? afterId;
      } while (batch.length === BATCH_SIZE);
    } catch (error) {
      this.logger.error(
        `Dispute deadlines failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
    } finally {
      this.running = false;
    }

    return escalated;
  }

  private async escalateOne(id: number, now: Date): Promise<boolean> {
    try {
      return await this.service.escalateOverdue(id, now);
    } catch (error) {
      this.logger.error(
        `Escalating dispute ${id} failed: ${(error as Error).message}`,
        (error as Error).stack,
      );

      return false;
    }
  }
}
