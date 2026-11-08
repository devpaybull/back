import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { MESSAGE_TEXT_MAX_LENGTH } from '../../common/utils/message-text-max-length';
import { DeviceMessageKind } from '../types/device-message-kind.enum';

const WITH_ZONE = /T.*(Z|[+-]\d{2}:?\d{2})$/;

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class ReceiveDeviceMessageDto {
  @ApiProperty({
    maxLength: 200,
    description:
      'The app’s own id of the message; a repeat is answered with the stored one',
  })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  externalId: string;

  @ApiProperty({ enum: DeviceMessageKind })
  @IsEnum(DeviceMessageKind)
  kind: DeviceMessageKind;

  @ApiProperty({ maxLength: 100, example: '900' })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  sender: string;

  @ApiProperty({ maxLength: MESSAGE_TEXT_MAX_LENGTH })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MESSAGE_TEXT_MAX_LENGTH)
  text: string;

  @ApiProperty({
    example: '2026-11-08T10:15:00Z',
    description:
      'When the phone received it, as the phone says: an ISO 8601 date-time with Z or an offset',
  })
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(WITH_ZONE, { message: 'receivedAt needs Z or an offset' })
  receivedAt: string;
}
