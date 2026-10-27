import { ApiProperty } from '@nestjs/swagger';

export class AttachmentCountsDto {
  @ApiProperty()
  traders: number;

  @ApiProperty()
  cascades: number;
}
