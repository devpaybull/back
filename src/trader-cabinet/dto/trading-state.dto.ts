import { ApiProperty } from '@nestjs/swagger';

export class TradingStateDto {
  @ApiProperty()
  enabled: boolean;
}
