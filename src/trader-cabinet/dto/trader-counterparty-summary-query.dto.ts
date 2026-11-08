import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class TraderCounterpartySummaryQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      '«Реквизит»: one of the trader’s counterparty-only requisites; another matches nothing',
  })
  @IsOptional()
  @IsUUID()
  bankDetailsId?: string;
}
