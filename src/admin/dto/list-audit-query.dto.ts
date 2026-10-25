import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { AuditSortField } from '../../audit/types/audit-sort-field.enum';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class ListAuditQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: AuditSortField,
    default: AuditSortField.CreatedAt,
  })
  @IsEnum(AuditSortField)
  sortBy: AuditSortField = AuditSortField.CreatedAt;
}
