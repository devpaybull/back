import {
  ApiPropertyOptional,
  IntersectionType,
  OmitType,
  PickType,
} from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { PayoutPoolSortField } from '../types/payout-pool-sort-field.enum';
import { TraderPayoutFilterDto } from './trader-payout-filter.dto';

export class ListPayoutPoolQueryDto extends IntersectionType(
  OmitType(PaginationQueryDto, ['search'] as const),
  PickType(TraderPayoutFilterDto, [
    'method',
    'amountFrom',
    'amountTo',
    'merchantGroupId',
    'search',
  ] as const),
) {
  @ApiPropertyOptional({
    enum: PayoutPoolSortField,
    default: PayoutPoolSortField.CreatedAt,
  })
  @IsEnum(PayoutPoolSortField)
  sortBy: PayoutPoolSortField = PayoutPoolSortField.CreatedAt;
}
