import { ApiProperty } from '@nestjs/swagger';
import { DisputeStatus } from '../../transactions/types/dispute-status.enum';
import { StatusEventSource } from '../../transactions/types/status-event-source.enum';
import { TransactionStatus } from '../../transactions/types/transaction-status.enum';
import { CardHistoryKind } from '../types/card-history-kind.enum';
import { CardActorDto } from './card-actor.dto';

export class CardHistoryEntryDto {
  @ApiProperty({ enum: CardHistoryKind })
  kind: CardHistoryKind;

  @ApiProperty()
  at: Date;

  @ApiProperty({ enum: TransactionStatus, nullable: true })
  fromStatus: TransactionStatus | null;

  @ApiProperty({ enum: TransactionStatus, nullable: true })
  toStatus: TransactionStatus | null;

  @ApiProperty({ enum: StatusEventSource, nullable: true })
  source: StatusEventSource | null;

  @ApiProperty({ type: CardActorDto, nullable: true })
  actor: CardActorDto | null;

  @ApiProperty({ nullable: true })
  reason: string | null;

  @ApiProperty({ nullable: true })
  disputeId: number | null;

  @ApiProperty({ enum: DisputeStatus, nullable: true })
  disputeStatus: DisputeStatus | null;
}
