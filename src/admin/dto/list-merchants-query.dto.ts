import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsOptional,
  Matches,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CALENDAR_DAY_PATTERN } from '../../common/utils/calendar-day-pattern';
import { MerchantSortField } from '../../merchants/types/merchant-sort-field.enum';
import { MerchantStatus } from '../../merchants/types/merchant-status.enum';
import { MerchantVolumePeriod } from '../types/merchant-volume-period.enum';
import { IsNotBelow } from '../utils/is-not-below';

const asBoolean = ({ value }: { value: unknown }): unknown => {
  if (value === 'true') return true;
  if (value === 'false') return false;

  return value;
};

export class ListMerchantsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: MerchantStatus })
  @IsOptional()
  @IsEnum(MerchantStatus)
  status?: MerchantStatus;

  @ApiPropertyOptional({ description: 'the «Искл. залив» flag' })
  @IsOptional()
  @Transform(asBoolean)
  @IsBoolean()
  exclusiveTopUp?: boolean;

  @ApiPropertyOptional({
    enum: MerchantVolumePeriod,
    default: MerchantVolumePeriod.Today,
    description:
      'the period of the method volumes, in calendar days of BUSINESS_TIMEZONE: today, yesterday, today and the six days before, or from the 1st of this month; not together with periodFrom/periodTo',
  })
  @IsOptional()
  @IsEnum(MerchantVolumePeriod)
  period?: MerchantVolumePeriod;

  @ApiPropertyOptional({
    example: '2026-10-01',
    description:
      'first day of a custom volume period (YYYY-MM-DD, inclusive, BUSINESS_TIMEZONE); needs periodTo',
  })
  @IsOptional()
  @Matches(CALENDAR_DAY_PATTERN)
  @IsISO8601({ strict: true })
  periodFrom?: string;

  @ApiPropertyOptional({
    example: '2026-10-26',
    description:
      'last day of a custom volume period (YYYY-MM-DD, inclusive, BUSINESS_TIMEZONE); needs periodFrom, earlier than it is a 400',
  })
  @IsOptional()
  @Matches(CALENDAR_DAY_PATTERN)
  @IsISO8601({ strict: true })
  @IsNotBelow('periodFrom')
  periodTo?: string;

  @ApiPropertyOptional({
    enum: MerchantSortField,
    default: MerchantSortField.CreatedAt,
  })
  @IsEnum(MerchantSortField)
  sortBy: MerchantSortField = MerchantSortField.CreatedAt;
}
