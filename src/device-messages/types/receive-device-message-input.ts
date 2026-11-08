import { DeviceMessageKind } from './device-message-kind.enum';

export interface ReceiveDeviceMessageInput {
  externalId: string;
  kind: DeviceMessageKind;
  sender: string;
  text: string;
  receivedAt: Date;
}
