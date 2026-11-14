import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { IsDateFilter } from '../../common/decorators/is-date-filter.decorator';
import { IsFiatAmount } from '../../common/decorators/is-fiat-amount.decorator';
import { IsNotBelow } from '../../common/decorators/is-not-below.decorator';
import { DayPeriod } from '../../common/enums/day-period.enum';
import { DEAL_SEARCH_MIN_LENGTH } from '../../common/utils/deal-search-min-length';
import { INT4_MAX } from '../../common/utils/int4-max';
import { toQueryList } from '../../common/utils/to-query-list';
import { TransactionKind } from '../../transactions/types/transaction-kind.enum';
import { TransactionMethod } from '../../transactions/types/transaction-method';
import { TransactionStatus } from '../../transactions/types/transaction-status.enum';
import { TRANSACTION_METHOD_CODES } from '../../transactions/utils/transaction-methods';

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class TransactionFilterDto {
  @ApiPropertyOptional({ enum: TransactionKind })
  @IsOptional()
  @IsEnum(TransactionKind)
  kind?: TransactionKind;

  @ApiPropertyOptional({
    enum: TransactionStatus,
    isArray: true,
    description:
      'One or several, repeated or comma-separated. Активная active · В ожидании pending · Апелляция dispute · На решении админа manual_review · Проверка чека checking · Ручная проверка checking_manually · Пересчитанная success_changed · Завершена success · Отмененная canceled',
  })
  @IsOptional()
  @Transform(toQueryList)
  @IsEnum(TransactionStatus, { each: true })
  status?: TransactionStatus[];

  @ApiPropertyOptional({
    enum: DayPeriod,
    description:
      'Calendar days of BUSINESS_TIMEZONE; not together with createdFrom/createdTo (400). Without either: all time',
  })
  @IsOptional()
  @IsEnum(DayPeriod)
  period?: DayPeriod;

  @ApiPropertyOptional({
    type: String,
    description: 'Created at or after this moment',
  })
  @IsOptional()
  @IsDateFilter()
  createdFrom?: string;

  @ApiPropertyOptional({
    type: String,
    description:
      'Created at or before this moment; earlier than createdFrom is a 400',
  })
  @IsOptional()
  @IsDateFilter()
  @IsNotBelow('createdFrom')
  createdTo?: string;

  @ApiPropertyOptional({ enum: TRANSACTION_METHOD_CODES })
  @IsOptional()
  @IsIn(TRANSACTION_METHOD_CODES)
  method?: TransactionMethod;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  traderUserId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  merchantId?: string;

  @ApiPropertyOptional({ type: Number, description: 'Группа мерчантов' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(INT4_MAX)
  merchantGroupId?: number;

  @ApiPropertyOptional({
    type: String,
    maxLength: 255,
    description: 'The counterparty id or the merchant’s payerInfo.userId',
  })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  counterparty?: string;

  @ApiPropertyOptional({
    type: String,
    maxLength: 100,
    description:
      'A piece of a card, phone or holder name: the requisite of a pay-in (deleted ones included) or the recipient of a pay-out',
  })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  requisite?: string;

  @ApiPropertyOptional({
    example: 1,
    description: 'The bank of the deal’s requisite',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(INT4_MAX)
  bankId?: number;

  @ApiPropertyOptional({
    type: String,
    example: '1000.00',
    description:
      'amountFiat at least this much, inclusive; a decimal string with at most 2 decimals',
  })
  @IsOptional()
  @IsFiatAmount()
  amountFrom?: string;

  @ApiPropertyOptional({
    type: String,
    example: '5000.00',
    description:
      'amountFiat at most this much, inclusive; below amountFrom is a 400',
  })
  @IsOptional()
  @IsFiatAmount()
  @IsNotBelow('amountFrom')
  amountTo?: string;

  @ApiPropertyOptional({
    minLength: DEAL_SEARCH_MIN_LENGTH,
    maxLength: 100,
    description:
      'A piece of the deal number: our id or the merchant’s merchantTransactionId',
  })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MinLength(DEAL_SEARCH_MIN_LENGTH)
  @MaxLength(100)
  search?: string;
}
