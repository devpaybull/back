import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Device } from '../entities/device.entity';
import { DeviceNetworkStatus } from '../types/device-network-status.enum';
import { DeviceStatus } from '../types/device-status.enum';
import { DeviceType } from '../types/device-type.enum';

export class OwnDeviceDto {
  @ApiProperty({ description: 'The «ID» on the page' })
  id: number;

  @ApiProperty({
    format: 'uuid',
    description: 'The «UUID» on the page: a public identifier, not a secret',
  })
  key: string;

  @ApiProperty({ enum: DeviceType })
  type: DeviceType;

  @ApiProperty()
  name: string;

  @ApiProperty({ enum: DeviceStatus })
  status: DeviceStatus;

  @ApiProperty({
    enum: DeviceNetworkStatus,
    description:
      'online while the last heartbeat is no older than DEVICE_ONLINE_WINDOW_SECONDS',
  })
  network: DeviceNetworkStatus;

  @ApiPropertyOptional({ nullable: true })
  model: string;

  @ApiPropertyOptional({ nullable: true })
  phone: string;

  @ApiPropertyOptional({ nullable: true })
  appVersion: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'When the app last paired; null until it has',
  })
  activatedAt: Date;

  @ApiPropertyOptional({ nullable: true, description: 'The last heartbeat' })
  lastActivity: Date;

  @ApiProperty({ description: 'Requisites bound to this device' })
  requisiteCount: number;

  @ApiProperty()
  createdAt: Date;
}

export const toOwnDeviceDto = (
  device: Device,
  onlineSince: Date,
  requisiteCount: number,
): OwnDeviceDto => ({
  id: device.id,
  key: device.key,
  type: device.type,
  name: device.name,
  status: device.status,
  network:
    device.lastActivity && device.lastActivity >= onlineSince
      ? DeviceNetworkStatus.Online
      : DeviceNetworkStatus.Offline,
  model: device.model ?? null,
  phone: device.phone ?? null,
  appVersion: device.appVersion ?? null,
  activatedAt: device.activatedAt ?? null,
  lastActivity: device.lastActivity ?? null,
  requisiteCount,
  createdAt: device.createdAt,
});
