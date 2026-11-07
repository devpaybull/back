import { ApiProperty } from '@nestjs/swagger';

export class DeviceHeartbeatAcceptedDto {
  @ApiProperty({ example: 30 })
  heartbeatSeconds: number;
}
