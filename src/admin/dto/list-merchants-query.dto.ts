import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { MerchantSortField } from '../../merchants/types/merchant-sort-field.enum';

export class ListMerchantsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: MerchantSortField,
    default: MerchantSortField.CreatedAt,
  })
  @IsEnum(MerchantSortField)
  sortBy: MerchantSortField = MerchantSortField.CreatedAt;
}
