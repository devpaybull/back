import { ApiProperty } from '@nestjs/swagger';

export class MerchantRateRowDto {
  @ApiProperty({ example: 7 })
  payInPercent: number;

  @ApiProperty({
    example: 2,
    description: '0 on a method that does not work in pay-out',
  })
  payOutPercent: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '1000.00',
    description:
      'an amount band (fiat), from — null on the general row and on a bank row',
  })
  fromAmount: string | null;

  @ApiProperty({ type: String, nullable: true, example: '50000.00' })
  toAmount: string | null;

  @ApiProperty({
    type: Object,
    nullable: true,
    description: '{ id, name } on a bank row',
  })
  bank: { id: number; name: string } | null;
}

export class MerchantMethodDirectionsDto {
  @ApiProperty()
  payIn: boolean;

  @ApiProperty()
  payOut: boolean;
}

export class MerchantMethodRatesDto {
  @ApiProperty({ example: 'sbp' })
  method: string;

  @ApiProperty({
    type: MerchantMethodDirectionsDto,
    description: 'the directions switched on for the merchant',
  })
  enabled: MerchantMethodDirectionsDto;

  @ApiProperty({
    type: MerchantRateRowDto,
    isArray: true,
    description:
      'the general row first (no band, no bank), then the bands, then the bank rows',
  })
  rates: MerchantRateRowDto[];
}

export class MerchantCurrencyRatesDto {
  @ApiProperty()
  currencyId: number;

  @ApiProperty({ example: 'RUB' })
  isocode: string;

  @ApiProperty({ type: MerchantMethodRatesDto, isArray: true })
  methods: MerchantMethodRatesDto[];
}
