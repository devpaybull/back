import { ApiProperty } from '@nestjs/swagger';

export class DealCounterpartyDto {
  @ApiProperty()
  id: number;

  @ApiProperty({ nullable: true })
  name: string | null;
}
