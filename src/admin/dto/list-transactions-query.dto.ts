import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { IsFiatAmount } from '../../common/decorators/is-fiat-amount.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { TransactionKind } from '../../transactions/types/transaction-kind.enum';
import { TransactionMethod } from '../../transactions/types/transaction-method';
import { TransactionSortField } from '../../transactions/types/transaction-sort-field.enum';
import { TransactionStatus } from '../../transactions/types/transaction-status.enum';
import { TRANSACTION_METHOD_CODES } from '../../transactions/utils/transaction-methods';
import { IsNotBelow } from '../utils/is-not-below';
import { IsDateFilter } from '../../common/decorators/is-date-filter.decorator';

export class ListTransactionsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: TransactionKind })
  @IsOptional()
  @IsEnum(TransactionKind)
  kind?: TransactionKind;

  @ApiPropertyOptional({ enum: TransactionStatus })
  @IsOptional()
  @IsEnum(TransactionStatus)
  status?: TransactionStatus;

  @ApiPropertyOptional({ enum: TRANSACTION_METHOD_CODES })
  @IsOptional()
  @IsIn(TRANSACTION_METHOD_CODES)
  method?: TransactionMethod;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  traderUserId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  merchantId?: string;

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

  @ApiPropertyOptional({
    example: 1,
    description: 'The bank of the deal’s requisite',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
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
      'amountFiat at most this much, inclusive; a decimal string with at most 2 decimals; below amountFrom is a 400',
  })
  @IsOptional()
  @IsFiatAmount()
  @IsNotBelow('amountFrom')
  amountTo?: string;

  @ApiPropertyOptional({
    enum: TransactionSortField,
    default: TransactionSortField.CreatedAt,
  })
  @IsEnum(TransactionSortField)
  sortBy: TransactionSortField = TransactionSortField.CreatedAt;
}
