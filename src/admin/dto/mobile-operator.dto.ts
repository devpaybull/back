import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MobileOperator } from '../../mobile-operators/entities/mobile-operator.entity';
import { CountryDto, toCountryDto } from './country.dto';

export class MobileOperatorDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  code: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  countryId: number;

  @ApiPropertyOptional({ type: CountryDto, nullable: true })
  country: CountryDto;

  @ApiProperty()
  active: boolean;

  @ApiProperty()
  createdAt: Date;
}

export const toMobileOperatorDto = (
  operator: MobileOperator,
): MobileOperatorDto => ({
  id: operator.id,
  code: operator.code,
  name: operator.name,
  countryId: operator.countryId,
  country: operator.country ? toCountryDto(operator.country) : null,
  active: operator.active,
  createdAt: operator.createdAt,
});
