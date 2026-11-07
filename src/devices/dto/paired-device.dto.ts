import { ApiProperty } from '@nestjs/swagger';

export class PairedDeviceDto {
  @ApiProperty({
    description:
      'The device credential, shown once. Send it as Authorization: Bearer <deviceToken> on every /device/* call.',
  })
  deviceToken: string;

  @ApiProperty({
    example: 30,
    description: 'How often to call /device/heartbeat',
  })
  heartbeatSeconds: number;
}
