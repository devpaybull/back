import { ApiProperty } from '@nestjs/swagger';

export class TraderMessageCountersDto {
  @ApiProperty({ description: 'Все' })
  all: number;

  @ApiProperty({ description: 'Push' })
  push: number;

  @ApiProperty({ description: 'SMS' })
  sms: number;

  @ApiProperty({ description: 'Зачисление' })
  credit: number;

  @ApiProperty({ description: 'Выписка' })
  statement: number;
}
