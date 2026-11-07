import {
  ApiPropertyOptional,
  IntersectionType,
  OmitType,
} from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { MerchantRequestSortField } from '../../merchant-requests/types/merchant-request-sort-field.enum';
import { MerchantRequestFilterDto } from './merchant-request-filter.dto';

export class ListMerchantRequestsQueryDto extends IntersectionType(
  OmitType(PaginationQueryDto, ['search'] as const),
  MerchantRequestFilterDto,
) {
  @ApiPropertyOptional({
    enum: MerchantRequestSortField,
    default: MerchantRequestSortField.ReceivedAt,
    description:
      'merchant is by name; amount and payerUserId put requests without one last in desc and first in asc; every sort ties on receivedAt, then the id',
  })
  @IsEnum(MerchantRequestSortField)
  sortBy: MerchantRequestSortField = MerchantRequestSortField.ReceivedAt;
}
