import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsDate, IsEnum, IsOptional } from 'class-validator';
import { toQueryList } from '../../common/utils/to-query-list';
import { BalanceKind } from '../../transactions/types/balance-kind.enum';
import { BalanceOperationType } from '../../transactions/types/balance-operation-type.enum';

export class BalanceOperationFilterDto {
  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Start of the period, inclusive (createdAt >= from)',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'End of the period, exclusive (createdAt < to)',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

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
