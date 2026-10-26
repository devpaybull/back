import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsDate, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { AccountTransactionSortField } from '../../account-transactions/types/account-transaction-sort-field.enum';
import { AccountTransactionStatus } from '../../account-transactions/types/account-transaction-status.enum';
import { AccountTransactionStatusReason } from '../../account-transactions/types/account-transaction-status-reason.enum';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { toQueryList } from '../../common/utils/to-query-list';
import { IsNotBelow } from '../utils/is-not-below';

export class ListAccountTransactionsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: AccountTransactionStatus,
    isArray: true,
    description:
      'One or several, repeated or comma-separated; tabs are the frontend’s',
  })
  @IsOptional()
  @Transform(toQueryList)
  @IsEnum(AccountTransactionStatus, { each: true })
  status?: AccountTransactionStatus[];

  @ApiPropertyOptional({ enum: AccountTransactionStatusReason })
  @IsOptional()
  @IsEnum(AccountTransactionStatusReason)
  statusReason?: AccountTransactionStatusReason;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Inclusive',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  createdFrom?: Date;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Inclusive; earlier than createdFrom is a 400',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  @IsNotBelow('createdFrom')
  createdTo?: Date;

  @ApiPropertyOptional({
    enum: AccountTransactionSortField,
    default: AccountTransactionSortField.CreatedAt,
  })
  @IsEnum(AccountTransactionSortField)
  sortBy: AccountTransactionSortField = AccountTransactionSortField.CreatedAt;
}
