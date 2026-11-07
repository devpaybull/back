import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { SelectionAttempt } from '../entities/selection-attempt.entity';

const INTERVAL_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class SelectionAttemptRetentionService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(SelectionAttemptRetentionService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @InjectRepository(SelectionAttempt)
    private readonly attempts: Repository<SelectionAttempt>,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.run(), INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async run(now: Date = new Date()): Promise<number> {
    if (this.running) return 0;

    this.running = true;
    try {
      const days = this.config.getOrThrow<number>(
        'SELECTION_ATTEMPTS_RETENTION_DAYS',
      );
      const result = await this.attempts.delete({
        createdAt: LessThan(new Date(now.getTime() - days * DAY_MS)),
      });

      return result.affected ?? 0;
    } catch (error) {
      this.logger.error(
        `Selection attempts cleanup failed: ${(error as Error).message}`,
        (error as Error).stack,
      );

      return 0;
    } finally {
      this.running = false;
    }
  }
}
