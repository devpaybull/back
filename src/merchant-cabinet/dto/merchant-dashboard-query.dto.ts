import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsISO8601, IsOptional, Matches } from 'class-validator';
import { IsNotBelow } from '../../common/decorators/is-not-below.decorator';
import { DayPeriod } from '../../common/enums/day-period.enum';
import { CALENDAR_DAY_PATTERN } from '../../common/utils/calendar-day-pattern';

export class MerchantDashboardQueryDto {
  @ApiPropertyOptional({
    enum: DayPeriod,
    default: DayPeriod.AllTime,
    description:
      'calendar days of BUSINESS_TIMEZONE: today, yesterday, today and the six days before, from the 1st of this month, or all time; not together with periodFrom/periodTo',
  })
  @IsOptional()
  @IsEnum(DayPeriod)
  period?: DayPeriod;

  @ApiPropertyOptional({
    example: '2026-10-01',
    description:
      'first day of a custom period (YYYY-MM-DD, inclusive); needs periodTo',
  })
  @IsOptional()
  @Matches(CALENDAR_DAY_PATTERN)
  @IsISO8601({ strict: true })
  periodFrom?: string;

  @ApiPropertyOptional({
    example: '2026-10-26',
    description:
      'last day of a custom period (inclusive); earlier than periodFrom is a 400',
  })
  @IsOptional()
  @Matches(CALENDAR_DAY_PATTERN)
  @IsISO8601({ strict: true })
  @IsNotBelow('periodFrom')
  periodTo?: string;
}
