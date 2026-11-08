import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { DeviceMessage } from '../entities/device-message.entity';

const INTERVAL_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class DeviceMessageRetentionService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DeviceMessageRetentionService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @InjectRepository(DeviceMessage)
    private readonly messages: Repository<DeviceMessage>,
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
        'DEVICE_MESSAGE_RETENTION_DAYS',
      );
      const result = await this.messages.delete({
        createdAt: LessThan(new Date(now.getTime() - days * DAY_MS)),
      });

      return result.affected ?? 0;
    } catch (error) {
      this.logger.error(
        `Device messages cleanup failed: ${(error as Error).message}`,
        (error as Error).stack,
      );

      return 0;
    } finally {
      this.running = false;
    }
  }
}
