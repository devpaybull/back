import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsDate, IsEnum, IsOptional } from 'class-validator';
import { toQueryList } from '../../common/utils/to-query-list';
import { AccountTransactionStatus } from '../types/account-transaction-status.enum';

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
}
