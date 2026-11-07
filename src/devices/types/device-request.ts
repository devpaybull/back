import { Request } from 'express';
import { Device } from '../entities/device.entity';

export interface DeviceRequest extends Request {
  device?: Device;
}
