import { ApiProperty } from '@nestjs/swagger';
import { DeviceMessage } from '../entities/device-message.entity';
import { DeviceMessageMatchStatus } from '../types/device-message-match-status.enum';
import { DeviceMessageType } from '../types/device-message-type.enum';

export class DeviceMessageAcceptedDto {
  @ApiProperty()
  id: number;

  @ApiProperty({ enum: DeviceMessageType })
  messageType: DeviceMessageType;

  @ApiProperty({ enum: DeviceMessageMatchStatus })
  matchStatus: DeviceMessageMatchStatus;

  @ApiProperty({ format: 'uuid', nullable: true })
  transactionId: string | null;
}

export const toDeviceMessageAcceptedDto = (
  message: DeviceMessage,
): DeviceMessageAcceptedDto => ({
  id: message.id,
  messageType: message.messageType,
  matchStatus: message.matchStatus,
  transactionId: message.transactionId ?? null,
});
