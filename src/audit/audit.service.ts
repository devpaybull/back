import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { sortDirection } from '../common/utils/sort-direction';
import { Page, toPage } from '../common/types/page';
import { AuditLog } from './entities/audit-log.entity';
import { AuditListQuery } from './types/audit-list-query';
import { AuditSortField } from './types/audit-sort-field.enum';
import { RecordAuditEntry } from './types/record-audit-entry';

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly logs: Repository<AuditLog>,
  ) {}

  record(entry: RecordAuditEntry, manager?: EntityManager): Promise<AuditLog> {
    const repository = manager ? manager.getRepository(AuditLog) : this.logs;

    return repository.save(
      repository.create({
        actorUserId: entry.actorUserId,
        targetUserId: entry.targetUserId ?? null,
        action: entry.action,
        reason: entry.reason ?? null,
        metadata: entry.metadata ?? null,
      }),
    );
  }

  async list(query: AuditListQuery): Promise<Page<AuditLog>> {
    const direction = sortDirection(query.sortOrder);
    const order =
      query.sortBy === AuditSortField.Id
        ? { id: direction }
        : { createdAt: direction, id: direction };

    return toPage(
      await this.logs.findAndCount({
        where: { targetUserId: query.targetUserId },
        order,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      query,
    );
  }
}
