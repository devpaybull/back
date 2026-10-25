import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DebtsService } from './debts.service';

const DUE_BATCH_SIZE = 100;

@Injectable()
export class DebtAutoWriteOffService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DebtAutoWriteOffService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly debts: DebtsService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const seconds = this.config.get<number>(
      'DEBT_AUTO_WRITE_OFF_INTERVAL_SECONDS',
    );

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

    try {
      const dueIds = await this.debts.findDueIds(now, DUE_BATCH_SIZE);
      let writtenOff = 0;

      for (const debtId of dueIds) {
        try {
          if (await this.debts.autoWriteOff(debtId, now)) writtenOff += 1;
        } catch (error) {
          this.logger.error(
            `Auto write-off of debt ${debtId} failed: ${(error as Error).message}`,
            (error as Error).stack,
          );
        }
      }

      return writtenOff;
    } catch (error) {
      this.logger.error(
        `Debt auto write-off failed: ${(error as Error).message}`,
        (error as Error).stack,
      );

      return 0;
    } finally {
      this.running = false;
    }
  }
}
