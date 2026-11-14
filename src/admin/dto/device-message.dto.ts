import { ApiProperty } from '@nestjs/swagger';
import { formatFiat } from '../../common/utils/format-fiat';
import { DeviceMessage } from '../../device-messages/entities/device-message.entity';
import { DeviceMessageKind } from '../../device-messages/types/device-message-kind.enum';
import { DeviceMessageMatchStatus } from '../../device-messages/types/device-message-match-status.enum';
import { DeviceMessageType } from '../../device-messages/types/device-message-type.enum';
import { DeviceMessageRowDetails } from '../types/device-message-row-details';
import { DeviceMessageDealDto } from './device-message-deal.dto';
import { DeviceMessageDeviceDto } from './device-message-device.dto';
import { DeviceMessageTemplateDto } from './device-message-template.dto';
import { DeviceMessageTraderDto } from './device-message-trader.dto';

export class DeviceMessageDto {
  @ApiProperty()
  id: number;

  @ApiProperty({ description: 'When the server got it' })
  createdAt: Date;

  @ApiProperty({ description: 'As the phone reported it' })
  receivedAt: Date;

  @ApiProperty({ type: DeviceMessageTraderDto, nullable: true })
  trader: DeviceMessageTraderDto | null;

  @ApiProperty({ type: DeviceMessageDeviceDto, nullable: true })
  device: DeviceMessageDeviceDto | null;

  @ApiProperty({ enum: DeviceMessageKind })
  kind: DeviceMessageKind;

  @ApiProperty({ enum: DeviceMessageType })
  messageType: DeviceMessageType;

  @ApiProperty({ description: 'The raw sender, as the phone reported it' })
  sender: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The bank of the template that read the message',
  })
  senderName: string | null;

  @ApiProperty({
    description: 'A template of this sender was active when it arrived',
  })
  senderKnown: boolean;

  @ApiProperty()
  text: string;

  @ApiProperty({ type: String, nullable: true, example: '1500.00' })
  parsedAmount: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'RUB',
    description: 'The currency of the template’s bank',
  })
  currency: string | null;

  @ApiProperty({
    enum: DeviceMessageMatchStatus,
    description:
      'matched — the deal was confirmed by this message; anything else is why it was not: no_template, no_candidate, ambiguous, bank_mismatch, account_inactive, confirm_failed; ignored — not a credit',
  })
  matchStatus: DeviceMessageMatchStatus;

  @ApiProperty({
    type: DeviceMessageDealDto,
    nullable: true,
    description: 'The deal this message confirmed, only when matched',
  })
  transaction: DeviceMessageDealDto | null;

  @ApiProperty({ type: DeviceMessageTemplateDto, nullable: true })
  template: DeviceMessageTemplateDto | null;
}

export const toDeviceMessageDto = (
  message: DeviceMessage,
  details: DeviceMessageRowDetails,
): DeviceMessageDto => ({
  id: message.id,
  createdAt: message.createdAt,
  receivedAt: message.receivedAt,
  trader: details.trader,
  device: details.device,
  kind: message.kind,
  messageType: message.messageType,
  sender: message.sender,
  senderName: details.senderName,
  senderKnown: message.senderKnown,
  text: message.text,
  parsedAmount: message.parsedAmount ? formatFiat(message.parsedAmount) : null,
  currency: details.currency,
  matchStatus: message.matchStatus,
  transaction: details.transaction,
  template: message.templateId != null ? { id: message.templateId } : null,
});
