import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class AddLeadDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  leadUserId: string;
}
