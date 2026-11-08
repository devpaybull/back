import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class ListTraderCounterpartyGroupsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: '«Реквизит»: one of the trader’s counterparty-only requisites',
  })
  @IsOptional()
  @IsUUID()
  bankDetailsId?: string;
}
