import { DeviceType } from './device-type.enum';

export interface CreateDeviceInput {
  userId: string;
  name: string;
  type?: DeviceType;
}
