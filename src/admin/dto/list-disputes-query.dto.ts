import { ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { toQueryList } from '../../common/utils/to-query-list';
import { DisputeStatus } from '../../transactions/types/dispute-status.enum';

export class ListDisputesQueryDto extends OmitType(PaginationQueryDto, [
  'search',
] as const) {
  @ApiPropertyOptional({ enum: DisputeStatus, isArray: true })
  @IsOptional()
  @Transform(toQueryList)
  @IsEnum(DisputeStatus, { each: true })
  status?: DisputeStatus[];

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  transactionId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  traderUserId?: string;
}
