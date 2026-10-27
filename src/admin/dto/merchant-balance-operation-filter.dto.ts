import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional } from 'class-validator';
import { IsDateFilter } from '../../common/decorators/is-date-filter.decorator';
import { toQueryList } from '../../common/utils/to-query-list';
import { MerchantBalanceOperationType } from '../../transactions/types/merchant-balance-operation-type.enum';

export class MerchantBalanceOperationFilterDto {
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
    enum: MerchantBalanceOperationType,
    isArray: true,
    description: 'One or several types: repeated or comma-separated',
  })
  @IsOptional()
  @Transform(toQueryList)
  @IsEnum(MerchantBalanceOperationType, { each: true })
  type?: MerchantBalanceOperationType[];
}
