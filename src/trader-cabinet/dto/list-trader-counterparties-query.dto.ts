import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { TraderCounterpartySortField } from '../../transactions/types/trader-counterparty-sort-field.enum';

const asBoolean = ({ value }: { value: unknown }): unknown => {
  if (value === 'true') return true;
  if (value === 'false') return false;

  return value;
};

export class ListTraderCounterpartiesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'The accordion’s requisite: one of the trader’s counterparty-only requisites; all of them when absent',
  })
  @IsOptional()
  @IsUUID()
  bankDetailsId?: string;

  @ApiPropertyOptional({
    default: false,
    description:
      '«Скрывать неактивных»: leave out a client disabled or blacklisted by the merchant’s side, or with no successful deal with this trader in the last 30 days',
  })
  @IsOptional()
  @Transform(asBoolean)
  @IsBoolean()
  hideInactive: boolean = false;

  @ApiPropertyOptional({
    enum: TraderCounterpartySortField,
    default: TraderCounterpartySortField.LastDealAt,
    description: 'Empty values last, ties on the id',
  })
  @IsEnum(TraderCounterpartySortField)
  sortBy: TraderCounterpartySortField = TraderCounterpartySortField.LastDealAt;
}
