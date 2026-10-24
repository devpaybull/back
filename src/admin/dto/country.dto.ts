import { ApiProperty } from '@nestjs/swagger';
import { Country } from '../../countries/entities/country.entity';

export class CountryDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  name: string;
}

export const toCountryDto = (country: Country): CountryDto => ({
  id: country.id,
  name: country.name,
});
