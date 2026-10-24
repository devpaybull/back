import { ApiProperty } from '@nestjs/swagger';
import { AuditRecord } from '../../audit/types/audit-record';
import { AuditSource } from '../../audit/types/audit-source.enum';

export class AuditLogDto {
  @ApiProperty()
  id: number;

  @ApiProperty({ enum: AuditSource })
  source: AuditSource;

  @ApiProperty({ nullable: true })
  actorUserId: string | null;

  @ApiProperty({
    nullable: true,
    description:
      'The superadmin whose login link opened the session the request came from',
  })
  impersonatorUserId: string | null;

  @ApiProperty({ nullable: true })
  targetUserId: string | null;

  @ApiProperty()
  action: string;

  @ApiProperty({ nullable: true })
  reason: string | null;

  @ApiProperty({ nullable: true, type: Object })
  metadata: Record<string, unknown> | null;

  @ApiProperty({ nullable: true })
  method: string | null;

  @ApiProperty({ nullable: true })
  path: string | null;

  @ApiProperty({ nullable: true, type: Object })
  params: Record<string, unknown> | null;

  @ApiProperty({ nullable: true })
  statusCode: number | null;

  @ApiProperty({ nullable: true })
  ip: string | null;

  @ApiProperty({ nullable: true })
  userAgent: string | null;

  @ApiProperty({ nullable: true })
  login: string | null;

  @ApiProperty({ nullable: true, type: Object })
  body: unknown;

  @ApiProperty()
  createdAt: Date;
}

export const toAuditLogDto = (row: AuditRecord): AuditLogDto => ({
  id: row.id,
  source: row.source,
  actorUserId: row.actorUserId,
  impersonatorUserId: row.impersonatorUserId,
  targetUserId: row.targetUserId,
  action: row.action,
  reason: row.reason,
  metadata: row.metadata,
  method: row.method,
  path: row.path,
  params: row.params,
  statusCode: row.statusCode,
  ip: row.ip,
  userAgent: row.userAgent,
  login: row.login,
  body: row.body,
  createdAt: row.createdAt,
});
