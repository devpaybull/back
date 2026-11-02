import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { COUNTERPARTY_STATS_METHOD_CODES } from '../../transactions/utils/counterparty-stats-method-codes';

export class CounterpartyStatsQueryDto {
  @ApiPropertyOptional({
    enum: COUNTERPARTY_STATS_METHOD_CODES,
    description: 'Every method when absent',
  })
  @IsOptional()
  @IsIn(COUNTERPARTY_STATS_METHOD_CODES)
  method?: string;
}
