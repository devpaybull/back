import { DeviceMessageKind } from './device-message-kind.enum';
import { DeviceMessageType } from './device-message-type.enum';

export interface DeviceMessageFilter {
  userId?: string;
  kind?: DeviceMessageKind;
  messageType?: DeviceMessageType;
  createdFrom?: Date;
  createdTo?: Date;
  deviceId?: number;
  deviceName?: string;
  sender?: string;
  showUnknownSenders?: boolean;
  transactionId?: string;
  search?: string;
}
