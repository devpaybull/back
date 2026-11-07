import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { IsFiatAmount } from '../../common/decorators/is-fiat-amount.decorator';
import { IsNotBelow } from '../../common/decorators/is-not-below.decorator';
import { DayPeriod } from '../../common/enums/day-period.enum';
import { CALENDAR_DAY_PATTERN } from '../../common/utils/calendar-day-pattern';
import { INT4_MAX } from '../../common/utils/int4-max';
import { toQueryList } from '../../common/utils/to-query-list';
import { MerchantRequestOperation } from '../../merchant-requests/types/merchant-request-operation.enum';
import { MerchantRequestResult } from '../../merchant-requests/types/merchant-request-result.enum';
import { TransactionKind } from '../../transactions/types/transaction-kind.enum';
import { TransactionMethod } from '../../transactions/types/transaction-method';
import { TRANSACTION_METHOD_CODES } from '../../transactions/utils/transaction-methods';
import { ANY_BANK } from '../utils/any-bank';

const SEARCH_MAX_LENGTH = 255;
const DECIMAL_ID = /^[1-9]\d*$/;

export class MerchantRequestFilterDto {
  @ApiPropertyOptional({
    enum: [MerchantRequestResult.Created, MerchantRequestResult.NotCreated],
    description: 'the tabs «Сделка создана» / «Сделка не создана»',
  })
  @IsOptional()
  @IsIn([MerchantRequestResult.Created, MerchantRequestResult.NotCreated])
  result?: MerchantRequestResult;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  merchantId?: string;

  @ApiPropertyOptional({
    enum: DayPeriod,
    default: DayPeriod.AllTime,
    description:
      'calendar days of BUSINESS_TIMEZONE on receivedAt: today, yesterday, today and the six days before, from the 1st of this month, or all time; not together with periodFrom/periodTo',
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

  @ApiPropertyOptional({
    type: String,
    example: '1000.00',
    description: 'the requested amount at least this much, inclusive',
  })
  @IsOptional()
  @IsFiatAmount()
  amountFrom?: string;

  @ApiPropertyOptional({
    type: String,
    example: '5000.00',
    description:
      'the requested amount at most this much, inclusive; below amountFrom is a 400',
  })
  @IsOptional()
  @IsFiatAmount()
  @IsNotBelow('amountFrom')
  amountTo?: string;

  @ApiPropertyOptional({
    oneOf: [
      { type: 'integer', minimum: 1 },
      { type: 'string', enum: [ANY_BANK] },
    ],
    description:
      'the bank the request asked for (its id), or «any» — requests that named no bank («Любой банк»)',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && DECIMAL_ID.test(value) ? Number(value) : value,
  )
  @ValidateIf((dto: MerchantRequestFilterDto) => dto.bankId !== ANY_BANK)
  @IsInt()
  @Min(1)
  @Max(INT4_MAX)
  bankId?: number | typeof ANY_BANK;

  @ApiPropertyOptional({ enum: TRANSACTION_METHOD_CODES })
  @IsOptional()
  @IsIn(TRANSACTION_METHOD_CODES)
  method?: TransactionMethod;

  @ApiPropertyOptional({ enum: TransactionKind })
  @IsOptional()
  @IsEnum(TransactionKind)
  direction?: TransactionKind;

  @ApiPropertyOptional({
    enum: MerchantRequestOperation,
    isArray: true,
    description:
      'one or several, repeated or comma-separated; without it every logged /v1 request is listed, reads and cancels included',
  })
  @IsOptional()
  @Transform(toQueryList)
  @IsEnum(MerchantRequestOperation, { each: true })
  operation?: MerchantRequestOperation[];

  @ApiPropertyOptional({
    maxLength: SEARCH_MAX_LENGTH,
    description:
      'the exact request id, deal id or merchantTransactionId, or a piece of the merchant’s name',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(SEARCH_MAX_LENGTH)
  search?: string;
}
