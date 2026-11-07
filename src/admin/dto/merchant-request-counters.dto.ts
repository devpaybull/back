import { ApiProperty } from '@nestjs/swagger';

export class MerchantRequestCountersDto {
  @ApiProperty({ description: '«Все»' })
  all: number;

  @ApiProperty({ description: '«Сделка создана»' })
  created: number;

  @ApiProperty({ description: '«Сделка не создана»' })
  notCreated: number;
}
