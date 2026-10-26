import { ApiProperty } from '@nestjs/swagger';

export class FinanceOperationCountsDto {
  @ApiProperty()
  all: number;

  @ApiProperty()
  deposit: number;

  @ApiProperty()
  withdrawal: number;

  @ApiProperty()
  transfer: number;
}
