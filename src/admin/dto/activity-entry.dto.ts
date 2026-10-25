import { ApiProperty } from '@nestjs/swagger';
import { AuditRecord } from '../../audit/types/audit-record';

export class ActivityActorDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ nullable: true })
  login: string | null;
}

export class ActivityEntryDto {
  @ApiProperty()
  id: number;

  @ApiProperty({ example: 'activity.device_added' })
  action: string;

  @ApiProperty({
    type: ActivityActorDto,
    nullable: true,
    description: 'Null when the system did it.',
  })
  actor: ActivityActorDto | null;

  @ApiProperty({
    type: ActivityActorDto,
    nullable: true,
    description:
      'The superadmin whose login-link session did it on the account’s behalf; null for everything else.',
  })
  impersonator: ActivityActorDto | null;

  @ApiProperty({ nullable: true, type: Object })
  metadata: Record<string, unknown> | null;

  @ApiProperty()
  createdAt: Date;
}

const accountOf = (
  userId: string | null,
  loginsById: ReadonlyMap<string, string>,
): ActivityActorDto | null =>
  userId === null
    ? null
    : { id: userId, login: loginsById.get(userId) ?? null };

export const toActivityEntryDto = (
  record: AuditRecord,
  loginsById: ReadonlyMap<string, string>,
): ActivityEntryDto => ({
  id: record.id,
  action: record.action,
  actor: accountOf(record.actorUserId, loginsById),
  impersonator: accountOf(record.impersonatorUserId, loginsById),
  metadata: record.metadata,
  createdAt: record.createdAt,
});
