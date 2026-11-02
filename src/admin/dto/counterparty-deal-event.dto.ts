import { ApiProperty } from '@nestjs/swagger';
import { StatusEventSource } from '../../transactions/types/status-event-source.enum';
import { TransactionStatus } from '../../transactions/types/transaction-status.enum';
import { CounterpartyDealDto } from './counterparty-deal.dto';
import { CounterpartyRequisiteDto } from './counterparty-requisite.dto';
import { CounterpartyTraderDto } from './counterparty-trader.dto';

export class CounterpartyDealEventDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({
    enum: TransactionStatus,
    nullable: true,
    description: 'Null for the deal’s creation',
  })
  fromStatus: TransactionStatus | null;

  @ApiProperty({ enum: TransactionStatus })
  toStatus: TransactionStatus;

  @ApiProperty({ enum: StatusEventSource })
  source: StatusEventSource;

  @ApiProperty({ type: CounterpartyDealDto })
  deal: CounterpartyDealDto;

  @ApiProperty({ type: CounterpartyTraderDto, nullable: true })
  trader: CounterpartyTraderDto | null;

  @ApiProperty({ type: CounterpartyRequisiteDto, nullable: true })
  requisite: CounterpartyRequisiteDto | null;
}
