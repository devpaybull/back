import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Device } from '../../devices/entities/device.entity';
import { DeviceStatus } from '../../devices/types/device-status.enum';
import { DeviceType } from '../../devices/types/device-type.enum';
import { InviteAccountDto, toInviteAccountDto } from './invite-account.dto';

export class DeviceDto {
  @ApiProperty()
  id: number;

  @ApiProperty({ format: 'uuid' })
  key: string;

  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiPropertyOptional({ type: InviteAccountDto, nullable: true })
  user: InviteAccountDto;

  @ApiProperty()
  name: string;

  @ApiProperty({ enum: DeviceStatus })
  status: DeviceStatus;

  @ApiProperty({ enum: DeviceType })
  type: DeviceType;

  @ApiPropertyOptional({ nullable: true })
  model: string;

  @ApiPropertyOptional({ nullable: true })
  phone: string;

  @ApiPropertyOptional({ nullable: true })
  lastActivity: Date;

  @ApiPropertyOptional({ nullable: true })
  activatedAt: Date;

  @ApiPropertyOptional({ nullable: true })
  appVersion: string;

  @ApiProperty()
  createdAt: Date;
}

export const toDeviceDto = (device: Device): DeviceDto => ({
  id: device.id,
  key: device.key,
  userId: device.userId,
  user: device.user ? toInviteAccountDto(device.user) : null,
  name: device.name,
  status: device.status,
  model: device.model ?? null,
  type: device.type,
  phone: device.phone ?? null,
  lastActivity: device.lastActivity ?? null,
  activatedAt: device.activatedAt ?? null,
  appVersion: device.appVersion ?? null,
  createdAt: device.createdAt,
});
