import { ApiProperty } from '@nestjs/swagger';

export class TraderBalancesDto {
  @ApiProperty({ type: String, example: '100.000000' })
  main: string;

  @ApiProperty({ type: String, example: '20.000000' })
  mainReserved: string;

  @ApiProperty({ type: String, example: '80.000000' })
  available: string;

  @ApiProperty({ type: String, example: '500.000000' })
  insurancePayIn: string;

  @ApiProperty({ type: String, example: '300.000000' })
  insurancePayOut: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '90.900000',
    description: 'RUB per USDT: Rapira + 1 %; null while Rapira is down',
  })
  rate: string | null;
}
