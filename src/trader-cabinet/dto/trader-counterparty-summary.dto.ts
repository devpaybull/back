import { ApiProperty } from '@nestjs/swagger';

export class TraderCounterpartySummaryDto {
  @ApiProperty({
    description: 'Counterparties bound to the trader’s requisites',
  })
  total: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 19.54,
    description:
      'Σ paid / Σ completed of their deals with this trader, two decimals',
  })
  averageConversion: number | null;

  @ApiProperty({
    type: String,
    example: '500000.50',
    description:
      'Σ amountFiat of their successful deals with this trader, resolved today and the 29 days before',
  })
  deposits30d: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '50000.50',
    description:
      'Σ amountFiat / count of their successful deals with this trader',
  })
  averageCheck: string | null;
}
