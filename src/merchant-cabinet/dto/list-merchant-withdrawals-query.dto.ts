import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { IsDateFilter } from '../../common/decorators/is-date-filter.decorator';
import { IsNotBelow } from '../../common/decorators/is-not-below.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { MerchantWithdrawalSortField } from '../types/merchant-withdrawal-sort-field.enum';

export class ListMerchantWithdrawalsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ type: String, description: 'Created at or after' })
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

  @ApiPropertyOptional({
    enum: MerchantWithdrawalSortField,
    default: MerchantWithdrawalSortField.CreatedAt,
  })
  @IsEnum(MerchantWithdrawalSortField)
  sortBy: MerchantWithdrawalSortField = MerchantWithdrawalSortField.CreatedAt;
}
