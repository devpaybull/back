import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AuditSource } from '../../audit/types/audit-source.enum';
import { ListAuditQueryDto } from './list-audit-query.dto';

const MAX_ACTION_LENGTH = 300;

export class ListAllAuditQueryDto extends ListAuditQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  targetUserId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  actorUserId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  impersonatorUserId?: string;

  @ApiPropertyOptional({
    maxLength: MAX_ACTION_LENGTH,
    example: 'POST /admin/users/:id/leads',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_ACTION_LENGTH)
  action?: string;

  @ApiPropertyOptional({ enum: AuditSource })
  @IsOptional()
  @IsEnum(AuditSource)
  source?: AuditSource;

  @ApiPropertyOptional({ minimum: 100, maximum: 599 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(599)
  statusCode?: number;
}
