import { ApiProperty } from '@nestjs/swagger';
import { RequisiteEventKind } from '../../counterparties/types/requisite-event-kind.enum';
import { RequisiteEventReason } from '../../counterparties/types/requisite-event-reason.enum';
import { RequisiteEventSource } from '../../counterparties/types/requisite-event-source.enum';
import { CounterpartyRequisiteDto } from './counterparty-requisite.dto';
import { CounterpartyTraderDto } from './counterparty-trader.dto';

export class CounterpartyRequisiteEventDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ enum: RequisiteEventKind })
  kind: RequisiteEventKind;

  @ApiProperty({ enum: RequisiteEventSource })
  source: RequisiteEventSource;

  @ApiProperty({ enum: RequisiteEventReason, nullable: true })
  reason: RequisiteEventReason | null;

  @ApiProperty({
    type: CounterpartyTraderDto,
    nullable: true,
    description: 'Null for the system',
  })
  actor: CounterpartyTraderDto | null;

  @ApiProperty({ type: CounterpartyRequisiteDto, nullable: true })
  requisite: CounterpartyRequisiteDto | null;
}
