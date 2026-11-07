import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsOptional } from 'class-validator';
import { IsDateFilter } from '../../common/decorators/is-date-filter.decorator';
import { IsNotBelow } from '../../common/decorators/is-not-below.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { toQueryList } from '../../common/utils/to-query-list';
import { TransactionKind } from '../../transactions/types/transaction-kind.enum';
import { TransactionMethod } from '../../transactions/types/transaction-method';
import { TransactionStatus } from '../../transactions/types/transaction-status.enum';
import { TRANSACTION_METHOD_CODES } from '../../transactions/utils/transaction-methods';
import { PaymentSortField } from '../types/payment-sort-field.enum';

export class ListPaymentsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: PaymentSortField,
    default: PaymentSortField.CreatedAt,
    description: 'amount is the amount the client pays',
  })
  @IsEnum(PaymentSortField)
  sortBy: PaymentSortField = PaymentSortField.CreatedAt;

  @ApiPropertyOptional({
    enum: TransactionStatus,
    isArray: true,
    description: 'One or several, repeated or comma-separated',
  })
  @IsOptional()
  @Transform(toQueryList)
  @IsEnum(TransactionStatus, { each: true })
  status?: TransactionStatus[];

  @ApiPropertyOptional({ enum: TransactionKind })
  @IsOptional()
  @IsEnum(TransactionKind)
  type?: TransactionKind;

  @ApiPropertyOptional({ enum: TRANSACTION_METHOD_CODES })
  @IsOptional()
  @IsIn(TRANSACTION_METHOD_CODES)
  method?: TransactionMethod;

  @ApiPropertyOptional({
    type: String,
    description:
      'Created at or after: an ISO date-time with a zone, or YYYY-MM-DD read as midnight in the business timezone',
  })
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
}
