import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DepositsService } from './deposits.service';

const BATCH_SIZE = 100;

@Injectable()
export class DepositExpiryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DepositExpiryService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly deposits: DepositsService,
  ) {}

  onModuleInit(): void {
    const seconds = this.config.get<number>(
      'DEPOSIT_EXPIRY_INTERVAL_SECONDS',
      30,
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
      let total = 0;
      let expired: number;

      do {
        expired = await this.deposits.expire(now, BATCH_SIZE);
        total += expired;
      } while (expired === BATCH_SIZE);

      return total;
    } catch (error) {
      this.logger.error(`Deposit expiry failed: ${(error as Error).message}`);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
