import {
  ApiPropertyOptional,
  IntersectionType,
  OmitType,
} from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { TraderPayoutSortField } from '../types/trader-payout-sort-field.enum';
import { TraderPayoutFilterDto } from './trader-payout-filter.dto';

export class ListTraderPayoutsQueryDto extends IntersectionType(
  OmitType(PaginationQueryDto, ['search'] as const),
  TraderPayoutFilterDto,
) {
  @ApiPropertyOptional({
    enum: TraderPayoutSortField,
    default: TraderPayoutSortField.CreatedAt,
  })
  @IsEnum(TraderPayoutSortField)
  sortBy: TraderPayoutSortField = TraderPayoutSortField.CreatedAt;
}
