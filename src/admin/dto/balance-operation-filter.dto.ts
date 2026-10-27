import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional } from 'class-validator';
import { toQueryList } from '../../common/utils/to-query-list';
import { BalanceKind } from '../../transactions/types/balance-kind.enum';
import { BalanceOperationType } from '../../transactions/types/balance-operation-type.enum';
import { IsDateFilter } from '../../common/decorators/is-date-filter.decorator';

export class BalanceOperationFilterDto {
  @ApiPropertyOptional({
    type: String,
    description: 'Start of the period, inclusive (createdAt >= from)',
  })
  @IsOptional()
  @IsDateFilter()
  from?: string;

  @ApiPropertyOptional({
    type: String,
    description: 'End of the period, exclusive (createdAt < to)',
  })
  @IsOptional()
  @IsDateFilter()
  to?: string;

  @ApiPropertyOptional({
    enum: BalanceOperationType,
    isArray: true,
    description: 'One or several types: repeated or comma-separated',
  })
  @IsOptional()
  @Transform(toQueryList)
  @IsEnum(BalanceOperationType, { each: true })
  type?: BalanceOperationType[];

  @ApiPropertyOptional({
    enum: BalanceKind,
    description: 'Which balance: main, insurance pay-in or pay-out',
  })
  @IsOptional()
  @IsEnum(BalanceKind)
  kind?: BalanceKind;
}
