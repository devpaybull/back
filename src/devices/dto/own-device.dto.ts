import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Device } from '../entities/device.entity';
import { DeviceModel } from '../types/device-model.enum';
import { DeviceStatus } from '../types/device-status.enum';

export class OwnDeviceDto {
  @ApiProperty()
  id: number;

  @ApiProperty({
    format: 'uuid',
    description: 'What the phone app is registered against',
  })
  key: string;

  @ApiProperty()
  name: string;

  @ApiProperty({
    enum: DeviceStatus,
    description: 'Reported by the phone app; off until it first checks in',
  })
  status: DeviceStatus;

  @ApiPropertyOptional({
    enum: DeviceModel,
    nullable: true,
    description: 'Reported by the phone app',
  })
  model: DeviceModel;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Reported by the phone app',
  })
  type: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Reported by the phone app',
  })
  phone: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Reported by the phone app',
  })
  lastActivity: Date;

  @ApiProperty()
  createdAt: Date;
}

export const toOwnDeviceDto = (device: Device): OwnDeviceDto => ({
  id: device.id,
  key: device.key,
  name: device.name,
  status: device.status,
  model: device.model ?? null,
  type: device.type ?? null,
  phone: device.phone ?? null,
  lastActivity: device.lastActivity ?? null,
  createdAt: device.createdAt,
});
