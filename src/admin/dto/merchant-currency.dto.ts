import { ApiProperty } from '@nestjs/swagger';
import { MerchantCurrency } from '../../merchants/entities/merchant-currency.entity';

export class MerchantCurrencyDto {
  @ApiProperty()
  currencyId: number;

  @ApiProperty({ example: 'RUB' })
  isocode: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ example: 1.5 })
  payInMarkupPercent: number;

  @ApiProperty({ example: 0 })
  payOutMarkupPercent: number;
}

export const toMerchantCurrencyDto = (
  row: MerchantCurrency,
): MerchantCurrencyDto => ({
  currencyId: row.currencyId,
  isocode: row.currency.isocode,
  name: row.currency.name,
  payInMarkupPercent: row.payInMarkupPercent,
  payOutMarkupPercent: row.payOutMarkupPercent,
});
