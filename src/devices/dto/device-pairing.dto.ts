import { ApiProperty } from '@nestjs/swagger';

export class DevicePairingDto {
  @ApiProperty({
    example:
      '{"deviceKey":"3f0c8c1e-2b7a-4d4e-9a51-0c6f1d3b9e21","pairingToken":"…"}',
    description:
      'What the QR code encodes: a JSON object with deviceKey and pairingToken. The app sends pairingToken to POST /device/pair. Single use; a new pairing voids the previous unused one.',
  })
  qrPayload: string;

  @ApiProperty()
  expiresAt: Date;
}
