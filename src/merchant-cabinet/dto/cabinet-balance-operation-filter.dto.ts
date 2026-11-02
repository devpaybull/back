import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IsDateFilter } from '../../common/decorators/is-date-filter.decorator';
import { toQueryList } from '../../common/utils/to-query-list';
import { MerchantBalanceOperationType } from '../../transactions/types/merchant-balance-operation-type.enum';
import { DEAL_SEARCH_MIN_LENGTH } from '../utils/deal-search-min-length';

export class CabinetBalanceOperationFilterDto {
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
    description: '«Причины»: one or several types, repeated or comma-separated',
  })
  @IsOptional()
  @Transform(toQueryList)
  @IsEnum(MerchantBalanceOperationType, { each: true })
  type?: MerchantBalanceOperationType[];

  @ApiPropertyOptional({
    minLength: DEAL_SEARCH_MIN_LENGTH,
    maxLength: 36,
    description: 'a piece of the deal number (its uuid), at least 4 characters',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(DEAL_SEARCH_MIN_LENGTH)
  @MaxLength(36)
  search?: string;
}
