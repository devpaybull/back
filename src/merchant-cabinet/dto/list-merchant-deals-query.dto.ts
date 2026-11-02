import {
  ApiPropertyOptional,
  IntersectionType,
  OmitType,
} from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { MerchantDealSortField } from '../types/merchant-deal-sort-field.enum';
import { MerchantDealFilterDto } from './merchant-deal-filter.dto';

export class ListMerchantDealsQueryDto extends IntersectionType(
  OmitType(PaginationQueryDto, ['search'] as const),
  MerchantDealFilterDto,
) {
  @ApiPropertyOptional({
    enum: MerchantDealSortField,
    default: MerchantDealSortField.CreatedAt,
    description: 'expiresAt is «Время до отмены»',
  })
  @IsEnum(MerchantDealSortField)
  sortBy: MerchantDealSortField = MerchantDealSortField.CreatedAt;
}
