import { DeviceMessageDealDto } from '../dto/device-message-deal.dto';
import { DeviceMessageDeviceDto } from '../dto/device-message-device.dto';
import { DeviceMessageTraderDto } from '../dto/device-message-trader.dto';

export interface DeviceMessageRowDetails {
  trader: DeviceMessageTraderDto | null;
  device: DeviceMessageDeviceDto | null;
  senderName: string | null;
  currency: string | null;
  transaction: DeviceMessageDealDto | null;
}
