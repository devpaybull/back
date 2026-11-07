import { ApiProperty } from '@nestjs/swagger';

export class DealFileDto {
  @ApiProperty({ format: 'uuid', description: 'Pass it in fileKeys' })
  fileKey: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  size: number;

  @ApiProperty()
  mime: string;
}
