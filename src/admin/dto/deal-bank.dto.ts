import { ApiProperty } from '@nestjs/swagger';

export class DealBankDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  name: string;
}
