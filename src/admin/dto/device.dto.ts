import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Device } from '../../devices/entities/device.entity';
import { DeviceModel } from '../../devices/types/device-model.enum';
import { DeviceStatus } from '../../devices/types/device-status.enum';
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

  @ApiPropertyOptional({ enum: DeviceModel, nullable: true })
  model: DeviceModel;

  @ApiPropertyOptional({ nullable: true })
  type: string;

  @ApiPropertyOptional({ nullable: true })
  phone: string;

  @ApiPropertyOptional({ nullable: true })
  lastActivity: Date;

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
  type: device.type ?? null,
  phone: device.phone ?? null,
  lastActivity: device.lastActivity ?? null,
  createdAt: device.createdAt,
});
