import { IntersectionType } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { MerchantBalanceOperationFilterDto } from './merchant-balance-operation-filter.dto';

export class ListMerchantBalanceOperationsQueryDto extends IntersectionType(
  PaginationQueryDto,
  MerchantBalanceOperationFilterDto,
) {}
