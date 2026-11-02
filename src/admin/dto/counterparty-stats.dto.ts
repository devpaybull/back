import { ApiProperty } from '@nestjs/swagger';
import { CounterpartyFunnelDto } from './counterparty-funnel.dto';

export class CounterpartyStatsDto {
  @ApiProperty({ nullable: true, description: 'Null for every method' })
  method: string | null;

  @ApiProperty({ example: 'RUB' })
  currency: string;

  @ApiProperty({ nullable: true })
  conversion: number | null;

  @ApiProperty()
  completedCount: number;

  @ApiProperty()
  paidCount: number;

  @ApiProperty()
  disputes: number;

  @ApiProperty({ type: String, nullable: true })
  averageCheck: string | null;

  @ApiProperty({ nullable: true })
  lastDepositAt: Date | null;

  @ApiProperty({ type: CounterpartyFunnelDto })
  funnel: CounterpartyFunnelDto;

  @ApiProperty({ type: String })
  volume7d: string;

  @ApiProperty({ type: String })
  volume30d: string;

  @ApiProperty({ type: String })
  volumeTotal: string;
}
