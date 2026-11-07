import { ApiProperty } from '@nestjs/swagger';

export class DeviceCountsDto {
  @ApiProperty()
  total: number;

  @ApiProperty()
  online: number;

  @ApiProperty()
  offline: number;
}
