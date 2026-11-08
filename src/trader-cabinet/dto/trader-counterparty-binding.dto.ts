import { ApiProperty } from '@nestjs/swagger';

export class TraderCounterpartyBindingDto {
  @ApiProperty()
  id: number;

  @ApiProperty({ format: 'uuid' })
  bankDetailsId: string;
}
