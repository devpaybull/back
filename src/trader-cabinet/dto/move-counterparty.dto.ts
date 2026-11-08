import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class MoveCounterpartyDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Another counterparty-only requisite of the same trader',
  })
  @IsUUID()
  bankDetailsId: string;
}
