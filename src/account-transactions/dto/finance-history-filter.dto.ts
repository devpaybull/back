import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional } from 'class-validator';
import { toQueryList } from '../../common/utils/to-query-list';
import { AccountTransactionStatus } from '../types/account-transaction-status.enum';
import { IsDateFilter } from '../../common/decorators/is-date-filter.decorator';

export class FinanceHistoryFilterDto {
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
}
