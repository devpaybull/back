import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { DebtEventSortField } from '../../debts/types/debt-event-sort-field.enum';

export class ListDebtEventsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: DebtEventSortField,
    default: DebtEventSortField.CreatedAt,
  })
  @IsEnum(DebtEventSortField)
  sortBy: DebtEventSortField = DebtEventSortField.CreatedAt;
}
