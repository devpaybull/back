import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Currency } from '../../currencies/entities/currency.entity';
import { CountryDto, toCountryDto } from './country.dto';

export class CurrencyDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  name: string;

  @ApiProperty()
  isocode: string;

  @ApiProperty()
  countryId: number;

  @ApiPropertyOptional({ type: CountryDto, nullable: true })
  country: CountryDto;
}

export const toCurrencyDto = (currency: Currency): CurrencyDto => ({
  id: currency.id,
  name: currency.name,
  isocode: currency.isocode,
  countryId: currency.countryId,
  country: currency.country ? toCountryDto(currency.country) : null,
});
