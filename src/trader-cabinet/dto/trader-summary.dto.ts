import { ApiProperty } from '@nestjs/swagger';
import { TrafficBlocker } from '../types/traffic-blocker.enum';

export class TraderSummaryBalanceDto {
  @ApiProperty({ type: String, example: '100.000000' })
  main: string;

  @ApiProperty({
    type: String,
    example: '80.000000',
    description: '«Мой баланс»: main minus reserved',
  })
  available: string;

  @ApiProperty({ type: String, example: '20.000000' })
  reserved: string;
}

export class TraderSummaryTradingDto {
  @ApiProperty({ description: 'The switch: whether pay-ins are offered' })
  payIn: boolean;

  @ApiProperty({ description: 'The switch and the access to pay-outs' })
  payOut: boolean;
}

export class TraderSummaryAccessDto {
  @ApiProperty({
    description: 'Off: the «Откупы» page and its badges are hidden',
  })
  payouts: boolean;
}

export class TraderSummaryCountersDto {
  @ApiProperty()
  activeDeals: number;

  @ApiProperty({ description: 'Pay-ins in dispute or manual review' })
  appeals: number;

  @ApiProperty()
  activePayouts: number;

  @ApiProperty({ description: 'Pay-outs in dispute or manual review' })
  payoutAppeals: number;

  @ApiProperty({ description: 'What the pool shows this trader' })
  availablePayouts: number;
}

export class TraderSummaryDto {
  @ApiProperty({ type: TraderSummaryBalanceDto })
  balance: TraderSummaryBalanceDto;

  @ApiProperty({ type: TraderSummaryTradingDto })
  trading: TraderSummaryTradingDto;

  @ApiProperty({ type: TraderSummaryAccessDto })
  access: TraderSummaryAccessDto;

  @ApiProperty({ type: TraderSummaryCountersDto })
  counters: TraderSummaryCountersDto;

  @ApiProperty({
    enum: TrafficBlocker,
    isArray: true,
    description: 'Why no pay-ins are offered now; empty when nothing is known',
  })
  blockers: TrafficBlocker[];
}
