import {
  ApiPropertyOptional,
  IntersectionType,
  OmitType,
} from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { TraderDealSortField } from '../types/trader-deal-sort-field.enum';
import { TraderDealFilterDto } from './trader-deal-filter.dto';

export class ListTraderDealsQueryDto extends IntersectionType(
  OmitType(PaginationQueryDto, ['search'] as const),
  TraderDealFilterDto,
) {
  @ApiPropertyOptional({
    enum: TraderDealSortField,
    default: TraderDealSortField.CreatedAt,
    description: 'expiresAt is «Время до отмены», traderCommission «Прибыль»',
  })
  @IsEnum(TraderDealSortField)
  sortBy: TraderDealSortField = TraderDealSortField.CreatedAt;
}
