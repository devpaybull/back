import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { toQueryList } from '../../common/utils/to-query-list';
import { AccountTransactionStatus } from '../types/account-transaction-status.enum';
import { AccountTransactionType } from '../types/account-transaction-type.enum';
import { IsDateFilter } from '../../common/decorators/is-date-filter.decorator';

export const FINANCE_SORT_FIELDS = ['createdAt', 'amount'] as const;

export class ListFinanceOperationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: AccountTransactionType,
    isArray: true,
    description: 'One or several, repeated or comma-separated',
  })
  @IsOptional()
  @Transform(toQueryList)
  @IsEnum(AccountTransactionType, { each: true })
  type?: AccountTransactionType[];

  @ApiPropertyOptional({
    enum: AccountTransactionStatus,
    isArray: true,
    description: 'One or several, repeated or comma-separated',
  })
  @IsOptional()
  @Transform(toQueryList)
  @IsEnum(AccountTransactionStatus, { each: true })
  status?: AccountTransactionStatus[];

  @ApiPropertyOptional({
    type: String,
    description: 'Inclusive',
  })
  @IsOptional()
  @IsDateFilter()
  from?: string;

  @ApiPropertyOptional({
    type: String,
    description: 'Exclusive',
  })
  @IsOptional()
  @IsDateFilter()
  to?: string;

  @ApiPropertyOptional({ enum: FINANCE_SORT_FIELDS, default: 'createdAt' })
  @IsIn(FINANCE_SORT_FIELDS)
  sortBy: (typeof FINANCE_SORT_FIELDS)[number] = 'createdAt';
}
