import { ApiProperty } from '@nestjs/swagger';

export class ApiMerchantBalanceDto {
  @ApiProperty({
    type: String,
    example: '120500.500000',
    description: 'the available balance, USDT',
  })
  available: string;

  @ApiProperty({
    type: String,
    example: '0.000000',
    description: 'held for pay-out deals in progress, USDT',
  })
  escrow: string;

  @ApiProperty({ enum: ['USDT'] })
  currency: 'USDT';
}
