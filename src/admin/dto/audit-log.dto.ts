import { ApiProperty } from '@nestjs/swagger';
import { AuditLog } from '../../audit/entities/audit-log.entity';

export class AuditLogDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  actorUserId: string;

  @ApiProperty({ nullable: true })
  targetUserId: string;

  @ApiProperty()
  action: string;

  @ApiProperty({ nullable: true })
  reason: string;

  @ApiProperty({ nullable: true, type: Object })
  metadata: Record<string, unknown>;

  @ApiProperty()
  createdAt: Date;
}

export const toAuditLogDto = (row: AuditLog): AuditLogDto => ({
  id: row.id,
  actorUserId: row.actorUserId,
  targetUserId: row.targetUserId,
  action: row.action,
  reason: row.reason,
  metadata: row.metadata,
  createdAt: row.createdAt,
});
