import { ApiProperty } from '@nestjs/swagger';
import { TraderCounterpartyStatus } from '../types/trader-counterparty-status.enum';

export class TraderCounterpartyDto {
  @ApiProperty({
    example: 1234,
    description:
      'The internal counterparty id; the merchant’s client id is never shown',
  })
  id: number;

  @ApiProperty({ format: 'uuid', description: 'The requisite it is bound to' })
  bankDetailsId: string;

  @ApiProperty({
    enum: TraderCounterpartyStatus,
    description:
      'inactive: disabled or blacklisted, or no successful deal with this trader in the last 30 days',
  })
  status: TraderCounterpartyStatus;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 54.5,
    description: 'paid / completed of its deals with this trader, two decimals',
  })
  conversion: number | null;

  @ApiProperty({ description: 'Successful deals with this trader' })
  paidCount: number;

  @ApiProperty({
    description: 'Successful and canceled deals with this trader',
  })
  completedCount: number;

  @ApiProperty({ type: String, nullable: true, example: '50000.50' })
  averageCheck: string | null;

  @ApiProperty({
    type: String,
    example: '500000.50',
    description:
      '«Общий объем»: Σ amountFiat of its successful deals with this trader',
  })
  volume: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Its latest deal with this trader, any status',
  })
  lastDealAt: Date | null;
}
