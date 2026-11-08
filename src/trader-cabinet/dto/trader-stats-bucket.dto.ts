import { ApiProperty } from '@nestjs/swagger';

export class TraderStatsBucketDto {
  @ApiProperty({
    example: '1000-2000',
    description:
      'By amountFiat: 1-999 is below 1000, 1000-2000 up to 2000 inclusive, 2001-5000 above 2000 up to 5000, 5001-10000 above 5000 up to 10000, 10000+ above 10000',
  })
  range: string;

  @ApiProperty({ description: '«Сделок по размеру чека»' })
  count: number;

  @ApiProperty({ type: String, example: '1250.540000', description: 'USDT' })
  volumeCrypto: string;

  @ApiProperty({ type: String, example: '112500.00', description: 'Fiat' })
  volumeFiat: string;
}
