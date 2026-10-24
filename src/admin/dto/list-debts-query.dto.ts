import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { DebtSortField } from '../../debts/types/debt-sort-field.enum';
import { DebtStatus } from '../../debts/types/debt-status.enum';

export class ListDebtsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: DebtStatus })
  @IsOptional()
  @IsEnum(DebtStatus)
  status?: DebtStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({
    enum: DebtSortField,
    default: DebtSortField.CreatedAt,
  })
  @IsEnum(DebtSortField)
  sortBy: DebtSortField = DebtSortField.CreatedAt;
}
