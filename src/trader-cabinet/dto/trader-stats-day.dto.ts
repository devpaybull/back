import { ApiProperty } from '@nestjs/swagger';

export class TraderStatsDayDto {
  @ApiProperty({
    example: '2026-11-08',
    description: 'A BUSINESS_TIMEZONE day',
  })
  date: string;

  @ApiProperty({
    type: String,
    example: '1332.000000',
    description: 'Σ traderCommission of the deals that succeeded that day',
  })
  income: string;

  @ApiProperty({
    type: String,
    example: '12222123.00',
    description: 'Σ amountFiat of the same deals',
  })
  turnover: string;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Of the deals created that day: paid / (paid + canceled); null with neither',
  })
  conversionPercent: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Of the deals created that day: those that ever went into dispute; null with none created',
  })
  disputePercent: number | null;
}
