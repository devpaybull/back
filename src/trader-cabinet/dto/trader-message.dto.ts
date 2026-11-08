import { ApiProperty } from '@nestjs/swagger';
import { formatFiat } from '../../common/utils/format-fiat';
import { DeviceMessage } from '../../device-messages/entities/device-message.entity';
import { DeviceMessageKind } from '../../device-messages/types/device-message-kind.enum';
import { DeviceMessageMatchStatus } from '../../device-messages/types/device-message-match-status.enum';
import { DeviceMessageType } from '../../device-messages/types/device-message-type.enum';

export class TraderMessageDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  deviceId: number;

  @ApiProperty({ enum: DeviceMessageKind })
  kind: DeviceMessageKind;

  @ApiProperty()
  sender: string;

  @ApiProperty({
    description: 'A template of this sender was active when it arrived',
  })
  senderKnown: boolean;

  @ApiProperty()
  text: string;

  @ApiProperty({ description: 'As the phone reported it' })
  receivedAt: Date;

  @ApiProperty({ description: 'When the server got it' })
  createdAt: Date;

  @ApiProperty({ enum: DeviceMessageType })
  messageType: DeviceMessageType;

  @ApiProperty({ nullable: true, description: 'The template that read it' })
  templateId: number | null;

  @ApiProperty({ type: String, nullable: true, example: '1500.00' })
  amount: string | null;

  @ApiProperty({
    enum: DeviceMessageMatchStatus,
    description:
      'matched — the deal was confirmed by this message; no_template — nothing read it; no_candidate, ambiguous (several deals of that amount), bank_mismatch (the one deal is on a requisite of another bank), account_inactive — read, nothing confirmed; ignored — not a credit',
  })
  matchStatus: DeviceMessageMatchStatus;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: 'The deal this message confirmed, «Подтверждена»',
  })
  transactionId: string | null;
}

export const toTraderMessageDto = (
  message: DeviceMessage,
): TraderMessageDto => ({
  id: message.id,
  deviceId: message.deviceId,
  kind: message.kind,
  sender: message.sender,
  senderKnown: message.senderKnown,
  text: message.text,
  receivedAt: message.receivedAt,
  createdAt: message.createdAt,
  messageType: message.messageType,
  templateId: message.templateId ?? null,
  amount: message.parsedAmount ? formatFiat(message.parsedAmount) : null,
  matchStatus: message.matchStatus,
  transactionId: message.transactionId ?? null,
});
