import { DeviceType } from './device-type.enum';

export interface OwnDeviceChanges {
  type?: DeviceType;
  name?: string;
  model?: string;
  phone?: string;
}
