import { ApiProperty } from '@nestjs/swagger';

export class MerchantConversionDto {
  @ApiProperty({ description: 'pay-ins created in the window that succeeded' })
  successful: number;

  @ApiProperty({ description: 'pay-ins created in the window' })
  total: number;

  @ApiProperty({ example: 25.5, description: 'two decimals; 0 with no pay-in' })
  percent: number;
}

export class MerchantTurnoverDto {
  @ApiProperty({
    type: String,
    example: '65100.500000',
    description: 'amountCrypto of pay-ins that succeeded in the window',
  })
  amount: string;

  @ApiProperty()
  count: number;
}

export class MerchantKpiDto {
  @ApiProperty({ description: 'start of the window, inclusive' })
  from: Date;

  @ApiProperty({ description: 'end of the window, exclusive' })
  to: Date;

  @ApiProperty({ type: MerchantConversionDto })
  conversion: MerchantConversionDto;

  @ApiProperty({ type: MerchantTurnoverDto })
  turnover: MerchantTurnoverDto;
}
