import { ApiProperty } from '@nestjs/swagger';

export class CounterpartyStatusCountsDto {
  @ApiProperty()
  all: number;

  @ApiProperty()
  enabled: number;

  @ApiProperty()
  disabled: number;
}
