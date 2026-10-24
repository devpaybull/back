import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, Not, Repository } from 'typeorm';
import { AuditLog } from '../entities/audit-log.entity';
import { VictoriaLogsService } from './victoria-logs.service';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AuditArchiveService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuditArchiveService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @InjectRepository(AuditLog)
    private readonly logs: Repository<AuditLog>,
    private readonly victoria: VictoriaLogsService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (!this.victoria.enabled) return;

    const seconds = this.config.get<number>('AUDIT_ARCHIVE_INTERVAL_SECONDS');

    this.timer = setInterval(() => void this.run(), seconds * 1000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async run(): Promise<void> {
    if (!this.victoria.enabled || this.running) return;

    this.running = true;

    try {
      const batchSize = this.config.get<number>('AUDIT_ARCHIVE_BATCH_SIZE');

      let archived: number;

      do {
        archived = await this.archiveBatch();
      } while (archived === batchSize);

      await this.purgeArchived();
    } catch (error) {
      this.logger.error(
        `Audit archival failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
    } finally {
      this.running = false;
    }
  }

  archiveBatch(): Promise<number> {
    const batchSize = this.config.get<number>('AUDIT_ARCHIVE_BATCH_SIZE');

    return this.logs.manager.transaction(async (manager) => {
      const rows = await manager
        .getRepository(AuditLog)
        .createQueryBuilder('log')
        .where('log.archivedAt IS NULL')
        .orderBy('log.id', 'ASC')
        .limit(batchSize)
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getMany();

      if (rows.length === 0) return 0;

      await this.victoria.insert(rows);

      await manager.update(
        AuditLog,
        { id: In(rows.map((row) => row.id)) },
        { archivedAt: () => 'now()' },
      );

      return rows.length;
    });
  }

  async purgeArchived(): Promise<number> {
    const days = this.config.get<number>('AUDIT_RETENTION_DAYS');
    const cutoff = new Date(Date.now() - days * DAY_MS);
    const result = await this.logs.delete({
      archivedAt: Not(IsNull()),
      createdAt: LessThan(cutoff),
    });

    return result.affected ?? 0;
  }
}
