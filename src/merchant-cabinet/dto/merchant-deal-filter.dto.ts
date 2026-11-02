import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IsDateFilter } from '../../common/decorators/is-date-filter.decorator';
import { IsFiatAmount } from '../../common/decorators/is-fiat-amount.decorator';
import { IsNotBelow } from '../../common/decorators/is-not-below.decorator';
import { toQueryList } from '../../common/utils/to-query-list';
import { TransactionKind } from '../../transactions/types/transaction-kind.enum';
import { TransactionMethod } from '../../transactions/types/transaction-method';
import { TransactionStatus } from '../../transactions/types/transaction-status.enum';
import { TRANSACTION_METHOD_CODES } from '../../transactions/utils/transaction-methods';
import { DEAL_SEARCH_MIN_LENGTH } from '../utils/deal-search-min-length';

export class MerchantDealFilterDto {
  @ApiPropertyOptional({
    enum: TransactionStatus,
    isArray: true,
    description:
      'One or several, repeated or comma-separated. Tabs: Активные active · В ожидании pending · Апелляция dispute,manual_review · Проверка чека checking · Ручная проверка checking_manually · Пересчитанная success_changed · Завершённые success · Отменённые canceled',
  })
  @IsOptional()
  @Transform(toQueryList)
  @IsEnum(TransactionStatus, { each: true })
  status?: TransactionStatus[];

  @ApiPropertyOptional({ enum: TransactionKind })
  @IsOptional()
  @IsEnum(TransactionKind)
  kind?: TransactionKind;

  @ApiPropertyOptional({ enum: TRANSACTION_METHOD_CODES })
  @IsOptional()
  @IsIn(TRANSACTION_METHOD_CODES)
  method?: TransactionMethod;

  @ApiPropertyOptional({ type: String, description: 'Created at or after' })
  @IsOptional()
  @IsDateFilter()
  createdFrom?: string;

  @ApiPropertyOptional({
    type: String,
    description: 'Created at or before; earlier than createdFrom is a 400',
  })
  @IsOptional()
  @IsDateFilter()
  @IsNotBelow('createdFrom')
  createdTo?: string;

  @ApiPropertyOptional({
    type: String,
    example: '1000.00',
    description: 'amountFiat at least this much, inclusive',
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
    maxLength: 36,
    description: 'a piece of the deal number (its uuid), at least 4 characters',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(DEAL_SEARCH_MIN_LENGTH)
  @MaxLength(36)
  search?: string;
}
