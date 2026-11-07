import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class UploadDealFileDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  dealId: string;
}
