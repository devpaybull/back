import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RequisiteHistoryActor } from '../types/requisite-history-actor.enum';
import { RequisiteHistoryEntry } from '../types/requisite-history-entry';

export class RequisiteHistoryEntryDto {
  @ApiProperty()
  id: number;

  @ApiProperty({
    example: 'bank_details.updated',
    description:
      'activity.bank_details_added · activity.bank_details_deleted · bank_details.updated · bank_details.enabled · bank_details.disabled · bank_details.banned · bank_details.unbanned',
  })
  action: string;

  @ApiProperty({
    enum: RequisiteHistoryActor,
    description:
      'trader — the owner (also in a login-link session), admin — an administrator, system — nobody',
  })
  actor: RequisiteHistoryActor;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  bankDetailsId: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description:
      'The requisite as it stood: id, type, card, phone, cardholderName, bankId, bankName, mobileOperatorId, mobileOperatorName; fields — what an update sent',
  })
  metadata: Record<string, unknown>;

  @ApiProperty({ description: 'Newer than the last POST …/history/read' })
  unread: boolean;

  @ApiProperty()
  createdAt: Date;
}

export const toRequisiteHistoryEntryDto = (
  { record, unread }: RequisiteHistoryEntry,
  traderUserId: string,
): RequisiteHistoryEntryDto => ({
  id: record.id,
  action: record.action,
  actor:
    record.actorUserId === null
      ? RequisiteHistoryActor.System
      : record.actorUserId === traderUserId
        ? RequisiteHistoryActor.Trader
        : RequisiteHistoryActor.Admin,
  bankDetailsId:
    typeof record.metadata?.id === 'string' ? record.metadata.id : null,
  metadata: record.metadata,
  unread,
  createdAt: record.createdAt,
});
