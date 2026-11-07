import { ApiProperty } from '@nestjs/swagger';

export class BankDetailsStatusCountsDto {
  @ApiProperty()
  all: number;

  @ApiProperty({ description: 'Switched on and not banned' })
  active: number;

  @ApiProperty({ description: 'Switched off and not banned' })
  disabled: number;

  @ApiProperty({ description: 'Banned by an administrator' })
  banned: number;
}
