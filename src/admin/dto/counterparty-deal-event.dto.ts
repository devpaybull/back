import { ApiProperty } from '@nestjs/swagger';
import { StatusEventSource } from '../../transactions/types/status-event-source.enum';
import { TransactionStatus } from '../../transactions/types/transaction-status.enum';
import { CounterpartyDealEventKind } from '../types/counterparty-deal-event-kind.enum';
import { CounterpartyDealRequestDto } from './counterparty-deal-request.dto';
import { CounterpartyDealDto } from './counterparty-deal.dto';
import { CounterpartyRequisiteDto } from './counterparty-requisite.dto';
import { CounterpartyTraderDto } from './counterparty-trader.dto';

export class CounterpartyDealEventDto {
  @ApiProperty({
    enum: CounterpartyDealEventKind,
    description:
      'status_changed: a row of the deal’s status history; deal_requested: «Запрос на создание сделки», a creation request of the client from the request log',
  })
  kind: CounterpartyDealEventKind;

  @ApiProperty({
    nullable: true,
    description: 'The status event’s id; null for deal_requested',
  })
  id: number | null;

  @ApiProperty({ description: 'when it happened; for a request, receivedAt' })
  createdAt: Date;

  @ApiProperty({
    enum: TransactionStatus,
    nullable: true,
    description: 'Null for the deal’s creation and for deal_requested',
  })
  fromStatus: TransactionStatus | null;

  @ApiProperty({
    enum: TransactionStatus,
    nullable: true,
    description: 'Null for deal_requested',
  })
  toStatus: TransactionStatus | null;

  @ApiProperty({
    enum: StatusEventSource,
    nullable: true,
    description: 'Null for deal_requested',
  })
  source: StatusEventSource | null;

  @ApiProperty({
    type: CounterpartyDealDto,
    nullable: true,
    description: 'Null for deal_requested — its deal is request.dealId',
  })
  deal: CounterpartyDealDto | null;

  @ApiProperty({
    type: CounterpartyTraderDto,
    nullable: true,
    description: 'for deal_requested, the trader that got the deal',
  })
  trader: CounterpartyTraderDto | null;

  @ApiProperty({ type: CounterpartyRequisiteDto, nullable: true })
  requisite: CounterpartyRequisiteDto | null;

  @ApiProperty({
    type: CounterpartyDealRequestDto,
    nullable: true,
    description: 'Only for deal_requested',
  })
  request: CounterpartyDealRequestDto | null;
}
