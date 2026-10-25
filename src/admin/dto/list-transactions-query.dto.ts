import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { TransactionKind } from '../../transactions/types/transaction-kind.enum';
import { TransactionMethod } from '../../transactions/types/transaction-method';
import { TransactionSortField } from '../../transactions/types/transaction-sort-field.enum';
import { TransactionStatus } from '../../transactions/types/transaction-status.enum';
import { TRANSACTION_METHOD_CODES } from '../../transactions/utils/transaction-methods';
import { IsNotBelow } from '../utils/is-not-below';

const toAmount = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' && value.trim() === '' ? Number.NaN : Number(value);

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
    format: 'date-time',
    description: 'Created at or after this moment',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  createdFrom?: Date;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description:
      'Created at or before this moment; earlier than createdFrom is a 400',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  @IsNotBelow('createdFrom')
  createdTo?: Date;

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
    description: 'amountFiat at least this much, inclusive',
  })
  @IsOptional()
  @Transform(toAmount)
  @IsNumber()
  @Min(0)
  amountFrom?: number;

  @ApiPropertyOptional({
    description:
      'amountFiat at most this much, inclusive; below amountFrom is a 400',
  })
  @IsOptional()
  @Transform(toAmount)
  @IsNumber()
  @Min(0)
  @IsNotBelow('amountFrom')
  amountTo?: number;

  @ApiPropertyOptional({
    enum: TransactionSortField,
    default: TransactionSortField.CreatedAt,
  })
  @IsEnum(TransactionSortField)
  sortBy: TransactionSortField = TransactionSortField.CreatedAt;
}
