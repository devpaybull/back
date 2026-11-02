import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class ReplaceCounterpartyRequisiteDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  bankDetailsId: string;
}
