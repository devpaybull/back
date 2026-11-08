import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { DeviceMessage } from '../entities/device-message.entity';

const INTERVAL_MS = 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 1000;
const MAX_BATCHES_PER_RUN = 50;

@Injectable()
export class DeviceMessageRetentionService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DeviceMessageRetentionService.name);
  private firstRun: NodeJS.Timeout | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @InjectRepository(DeviceMessage)
    private readonly messages: Repository<DeviceMessage>,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    this.firstRun = setTimeout(() => void this.run(), FIRST_RUN_DELAY_MS);
    this.firstRun.unref();
    this.timer = setInterval(() => void this.run(), INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.firstRun) clearTimeout(this.firstRun);
    if (this.timer) clearInterval(this.timer);
    this.firstRun = null;
    this.timer = null;
  }

  async run(now: Date = new Date()): Promise<number> {
    if (this.running) return 0;

    this.running = true;
    let deleted = 0;
    try {
      const days = this.config.getOrThrow<number>(
        'DEVICE_MESSAGE_RETENTION_DAYS',
      );
      const cutoff = new Date(now.getTime() - days * DAY_MS);

      for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch += 1) {
        const ids = (
          await this.messages.find({
            select: { id: true },
            where: { createdAt: LessThan(cutoff) },
            order: { id: 'ASC' },
            take: BATCH_SIZE,
          })
        ).map((message) => message.id);

        if (ids.length === 0) break;

        const result = await this.messages.delete({ id: In(ids) });
        deleted += result.affected ?? 0;

        if (ids.length < BATCH_SIZE) break;
      }

      return deleted;
    } catch (error) {
      this.logger.error(
        `Device messages cleanup failed: ${(error as Error).message}`,
        (error as Error).stack,
      );

      return deleted;
    } finally {
      this.running = false;
    }
  }
}
