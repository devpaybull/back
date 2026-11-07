import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, Not, Repository } from 'typeorm';
import { VictoriaLogsService } from '../../audit/services/victoria-logs.service';
import { ArchiveLine } from '../../audit/types/archive-line';
import { formatFiat } from '../../common/utils/format-fiat';
import { MerchantApiRequest } from '../entities/merchant-api-request.entity';

const DAY_MS = 24 * 60 * 60 * 1000;
const ARCHIVE_SOURCE = 'merchant_api';

const iso = (value: Date | null): string | null =>
  value === null ? null : new Date(value).toISOString();

const toLine = (row: MerchantApiRequest): ArchiveLine => ({
  source: ARCHIVE_SOURCE,
  message: `${row.method} ${row.path}`,
  requestId: row.id,
  merchantId: row.merchantId,
  apiKeyId: row.apiKeyId,
  method: row.method,
  path: row.path,
  ip: row.ip,
  requestHeaders: JSON.stringify(row.requestHeaders),
  requestBody: row.requestBody,
  requestBodyTruncated: row.requestBodyTruncated,
  statusCode: row.statusCode,
  responseBody: row.responseBody,
  responseBodyTruncated: row.responseBodyTruncated,
  errorCode: row.errorCode,
  durationMs: row.durationMs,
  result: row.result,
  operation: row.operation,
  direction: row.direction,
  paymentMethod: row.paymentMethod,
  amountFiat: row.amountFiat === null ? null : formatFiat(row.amountFiat),
  currency: row.currency,
  requestedBankId: row.requestedBankId,
  payerUserId: row.payerUserId,
  merchantTransactionId: row.merchantTransactionId,
  transactionId: row.transactionId,
  processedByUserId: row.processedByUserId,
  selectionSummary:
    row.selectionSummary === null ? null : JSON.stringify(row.selectionSummary),
  receivedAt: iso(row.receivedAt),
  createdAt: new Date(row.createdAt).toISOString(),
  updatedAt: iso(row.updatedAt),
});

@Injectable()
export class MerchantRequestArchiveService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(MerchantRequestArchiveService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @InjectRepository(MerchantApiRequest)
    private readonly requests: Repository<MerchantApiRequest>,
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
        `Merchant request archival failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
    } finally {
      this.running = false;
    }
  }

  archiveBatch(): Promise<number> {
    const batchSize = this.config.get<number>('AUDIT_ARCHIVE_BATCH_SIZE');

    return this.requests.manager.transaction(async (manager) => {
      const rows = await manager
        .getRepository(MerchantApiRequest)
        .createQueryBuilder('request')
        .where('request.archivedAt IS NULL')
        .orderBy('request.receivedAt', 'ASC')
        .addOrderBy('request.id', 'ASC')
        .limit(batchSize)
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getMany();

      if (rows.length === 0) return 0;

      await this.victoria.insertLines(rows.map(toLine));

      await manager.update(
        MerchantApiRequest,
        { id: In(rows.map((row) => row.id)) },
        { archivedAt: () => 'now()' },
      );

      return rows.length;
    });
  }

  async purgeArchived(): Promise<number> {
    const days = this.config.get<number>('MERCHANT_REQUEST_RETENTION_DAYS');
    const cutoff = new Date(Date.now() - days * DAY_MS);
    const result = await this.requests.delete({
      archivedAt: Not(IsNull()),
      receivedAt: LessThan(cutoff),
    });

    return result.affected ?? 0;
  }
}
