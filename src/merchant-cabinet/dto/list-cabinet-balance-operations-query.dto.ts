import { IntersectionType, OmitType } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CabinetBalanceOperationFilterDto } from './cabinet-balance-operation-filter.dto';

export class ListCabinetBalanceOperationsQueryDto extends IntersectionType(
  OmitType(PaginationQueryDto, ['search'] as const),
  CabinetBalanceOperationFilterDto,
) {}
