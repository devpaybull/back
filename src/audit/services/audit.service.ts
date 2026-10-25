import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, FindOptionsWhere, In, Repository } from 'typeorm';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { sortDirection } from '../../common/utils/sort-direction';
import { Page, toPage } from '../../common/types/page';
import { AuditLog } from '../entities/audit-log.entity';
import { AuditListQuery } from '../types/audit-list-query';
import { AuditRecord } from '../types/audit-record';
import { AuditSortField } from '../types/audit-sort-field.enum';
import { AuditSource } from '../types/audit-source.enum';
import { RecordAuditEntry } from '../types/record-audit-entry';
import { RecordHttpAuditEntry } from '../types/record-http-audit-entry';
import { VictoriaLogsService } from './victoria-logs.service';

type Segment = (skip: number, take: number) => Promise<[AuditRecord[], number]>;

const ARCHIVE_UNAVAILABLE = 'The audit archive is unavailable';
const FOREIGN_KEY_VIOLATION = '23503';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly logs: Repository<AuditLog>,
    private readonly victoria: VictoriaLogsService,
  ) {}

  record(entry: RecordAuditEntry, manager?: EntityManager): Promise<AuditLog> {
    const repository = manager ? manager.getRepository(AuditLog) : this.logs;

    return repository.save(
      repository.create({
        actorUserId: entry.actorUserId,
        impersonatorUserId: entry.impersonatorUserId ?? null,
        targetUserId: entry.targetUserId ?? null,
        action: entry.action,
        reason: entry.reason ?? null,
        metadata: entry.metadata ?? null,
      }),
    );
  }

  async recordHttp(entry: RecordHttpAuditEntry): Promise<AuditLog> {
    try {
      return await this.saveHttp(entry);
    } catch (error) {
      const code = (error as { driverError?: { code?: string } }).driverError
        ?.code;

      if (entry.targetUserId === null || code !== FOREIGN_KEY_VIOLATION) {
        throw error;
      }

      return this.saveHttp({ ...entry, targetUserId: null });
    }
  }

  async list(query: AuditListQuery): Promise<Page<AuditRecord>> {
    const skip = (query.page - 1) * query.limit;
    const fromPostgres = this.postgresSegment(query);

    if (!this.victoria.enabled) {
      return toPage(await fromPostgres(skip, query.limit), query);
    }

    const fromArchive = this.archiveSegment(query, await this.lowestStoredId());
    const [first, second] =
      query.sortOrder === SortOrder.Asc
        ? [fromArchive, fromPostgres]
        : [fromPostgres, fromArchive];

    const [firstRows, firstTotal] = await first(skip, query.limit);
    const [secondRows, secondTotal] = await second(
      Math.max(0, skip - firstTotal),
      query.limit - firstRows.length,
    );

    return toPage(
      [[...firstRows, ...secondRows], firstTotal + secondTotal],
      query,
    );
  }

  private saveHttp(entry: RecordHttpAuditEntry): Promise<AuditLog> {
    return this.logs.save(
      this.logs.create({ ...entry, source: AuditSource.Http }),
    );
  }

  private postgresSegment(query: AuditListQuery): Segment {
    const direction = sortDirection(query.sortOrder);
    const where: FindOptionsWhere<AuditLog> = {
      ...(query.targetUserId ? { targetUserId: query.targetUserId } : {}),
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
      ...(query.impersonatorUserId
        ? { impersonatorUserId: query.impersonatorUserId }
        : {}),
      ...(query.action
        ? { action: query.action }
        : query.actions
          ? { action: In([...query.actions]) }
          : {}),
      ...(query.source ? { source: query.source } : {}),
      ...(query.statusCode !== undefined
        ? { statusCode: query.statusCode }
        : {}),
    };
    const order =
      query.sortBy === AuditSortField.Id
        ? { id: direction }
        : { createdAt: direction, id: direction };

    return async (skip, take) =>
      take > 0
        ? this.logs.findAndCount({ where, order, skip, take })
        : [[], await this.logs.count({ where })];
  }

  private archiveSegment(
    query: AuditListQuery,
    belowId: number | null,
  ): Segment {
    return async (skip, take) => {
      try {
        return await this.victoria.find({
          belowId,
          sortOrder: query.sortOrder,
          skip,
          take,
          targetUserId: query.targetUserId,
          actorUserId: query.actorUserId,
          impersonatorUserId: query.impersonatorUserId,
          action: query.action,
          actions: query.actions,
          source: query.source,
          statusCode: query.statusCode,
        });
      } catch (error) {
        this.logger.error(
          `Audit archive read failed: ${(error as Error).message}`,
        );
        throw new ServiceUnavailableException(ARCHIVE_UNAVAILABLE);
      }
    };
  }

  private async lowestStoredId(): Promise<number | null> {
    const row = await this.logs
      .createQueryBuilder('log')
      .select('MIN(log.id)', 'min')
      .getRawOne<{ min: number | string | null }>();

    return row?.min === null || row?.min === undefined ? null : Number(row.min);
  }
}
