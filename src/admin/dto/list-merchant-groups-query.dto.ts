import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { MerchantGroupSortField } from '../../merchants/types/merchant-group-sort-field.enum';

export class ListMerchantGroupsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: MerchantGroupSortField,
    default: MerchantGroupSortField.CreatedAt,
  })
  @IsEnum(MerchantGroupSortField)
  sortBy: MerchantGroupSortField = MerchantGroupSortField.CreatedAt;
}
