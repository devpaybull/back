import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope-response.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentDevice } from '../decorators/current-device.decorator';
import { DevicesService } from '../devices.service';
import { DeviceHeartbeatAcceptedDto } from '../dto/device-heartbeat-accepted.dto';
import { DeviceHeartbeatDto } from '../dto/device-heartbeat.dto';
import { PairDeviceDto } from '../dto/pair-device.dto';
import { PairedDeviceDto } from '../dto/paired-device.dto';
import { Device } from '../entities/device.entity';
import { DeviceTokenGuard } from '../guards/device-token.guard';

@ApiTags('Device API')
@Public()
@Controller('device')
export class DeviceApiController {
  constructor(private readonly devices: DevicesService) {}

  @Post('pair')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Exchanges the pairing token from the QR code for a device token',
    description:
      'An unknown token, or one of a deleted device, is a 401; a used or expired one is a 410. Pairing revokes every earlier device token of the device.',
  })
  @ApiEnvelopeResponse(PairedDeviceDto)
  pair(@Body() dto: PairDeviceDto): Promise<PairedDeviceDto> {
    return this.devices.pair(dto);
  }

  @Post('heartbeat')
  @HttpCode(HttpStatus.OK)
  @UseGuards(DeviceTokenGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Reports that the app is alive',
    description:
      'Authorization: Bearer <deviceToken>. Moves lastActivity to now; a revoked token or a deleted device is a 401.',
  })
  @ApiEnvelopeResponse(DeviceHeartbeatAcceptedDto)
  async heartbeat(
    @Body() dto: DeviceHeartbeatDto,
    @CurrentDevice() device: Device,
  ): Promise<DeviceHeartbeatAcceptedDto> {
    await this.devices.heartbeat(device.id, dto.appVersion);

    return { heartbeatSeconds: this.devices.heartbeatSeconds };
  }
}
