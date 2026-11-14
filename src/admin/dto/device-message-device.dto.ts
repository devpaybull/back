import { ApiProperty } from '@nestjs/swagger';

export class DeviceMessageDeviceDto {
  @ApiProperty()
  id: number;

  @ApiProperty({ description: 'A deleted device keeps its name here' })
  name: string;
}
