import { ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { toQueryList } from '../../common/utils/to-query-list';
import { DisputeStatus } from '../../transactions/types/dispute-status.enum';

export class ListAppealsQueryDto extends OmitType(PaginationQueryDto, [
  'search',
] as const) {
  @ApiPropertyOptional({
    enum: DisputeStatus,
    isArray: true,
    description:
      'One or several. By default everything the trader can see; a deferred dispute is not an appeal yet',
  })
  @IsOptional()
  @Transform(toQueryList)
  @IsEnum(DisputeStatus, { each: true })
  status?: DisputeStatus[];
}
