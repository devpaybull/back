import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CounterpartySortField } from '../../counterparties/types/counterparty-sort-field.enum';

export class ListCounterpartiesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  merchantId?: string;

  @ApiPropertyOptional({
    enum: CounterpartySortField,
    default: CounterpartySortField.CreatedAt,
  })
  @IsEnum(CounterpartySortField)
  sortBy: CounterpartySortField = CounterpartySortField.CreatedAt;
}
