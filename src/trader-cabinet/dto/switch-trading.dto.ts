import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class SwitchTradingDto {
  @ApiProperty()
  @IsBoolean()
  enabled: boolean;
}
