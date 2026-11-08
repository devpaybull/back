import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse } from '../common/decorators/api-envelope-response.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CurrentDevice } from '../devices/decorators/current-device.decorator';
import { Device } from '../devices/entities/device.entity';
import { DeviceTokenGuard } from '../devices/guards/device-token.guard';
import {
  DeviceMessageAcceptedDto,
  toDeviceMessageAcceptedDto,
} from './dto/device-message-accepted.dto';
import { ReceiveDeviceMessageDto } from './dto/receive-device-message.dto';
import { DeviceMessagesService } from './services/device-messages.service';

@ApiTags('Device API')
@Public()
@Controller('device')
export class DeviceMessagesController {
  constructor(private readonly messages: DeviceMessagesService) {}

  @Post('messages')
  @HttpCode(HttpStatus.OK)
  @UseGuards(DeviceTokenGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Hands over an SMS or a push the phone received',
    description:
      'Authorization: Bearer <deviceToken>. Idempotent by (device, externalId): a repeat answers the stored message and changes nothing. The text is read by the active bank message templates of its sender; a credit whose amount matches exactly one active, checking or checking_manually pay-in on this device’s requisites, created no later than receivedAt plus DEVICE_MESSAGE_CLOCK_TOLERANCE_SECONDS, at the template’s bank, confirms that deal (source device).',
  })
  @ApiEnvelopeResponse(DeviceMessageAcceptedDto)
  async receive(
    @Body() dto: ReceiveDeviceMessageDto,
    @CurrentDevice() device: Device,
  ): Promise<DeviceMessageAcceptedDto> {
    return toDeviceMessageAcceptedDto(
      await this.messages.receive(device, {
        ...dto,
        receivedAt: new Date(dto.receivedAt),
      }),
    );
  }
}
