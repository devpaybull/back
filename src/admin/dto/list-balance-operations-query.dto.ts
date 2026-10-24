import { IntersectionType } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { BalanceOperationFilterDto } from './balance-operation-filter.dto';

export class ListBalanceOperationsQueryDto extends IntersectionType(
  PaginationQueryDto,
  BalanceOperationFilterDto,
) {}
