import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsDate, IsEnum, IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { toQueryList } from '../../common/utils/to-query-list';
import { AccountTransactionStatus } from '../types/account-transaction-status.enum';
import { AccountTransactionType } from '../types/account-transaction-type.enum';

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
    format: 'date-time',
    description: 'Inclusive',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Exclusive',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

  @ApiPropertyOptional({ enum: FINANCE_SORT_FIELDS, default: 'createdAt' })
  @IsIn(FINANCE_SORT_FIELDS)
  sortBy: (typeof FINANCE_SORT_FIELDS)[number] = 'createdAt';
}
