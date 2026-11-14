import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IsDateFilter } from '../../common/decorators/is-date-filter.decorator';
import { IsNotBelow } from '../../common/decorators/is-not-below.decorator';
import { DayPeriod } from '../../common/enums/day-period.enum';
import { INT4_MAX } from '../../common/utils/int4-max';
import { DeviceMessageKind } from '../../device-messages/types/device-message-kind.enum';
import { DeviceMessageType } from '../../device-messages/types/device-message-type.enum';
import { UnknownSenders } from '../../device-messages/types/unknown-senders.enum';

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class DeviceMessageFilterDto {
  @ApiPropertyOptional({
    enum: DeviceMessageKind,
    description: 'The tabs Push and SMS',
  })
  @IsOptional()
  @IsEnum(DeviceMessageKind)
  kind?: DeviceMessageKind;

  @ApiPropertyOptional({
    enum: DeviceMessageType,
    description:
      'The tabs Зачисление credit and Выписка statement; unknown is a text no template read',
  })
  @IsOptional()
  @IsEnum(DeviceMessageType)
  messageType?: DeviceMessageType;

  @ApiPropertyOptional({
    enum: DayPeriod,
    default: DayPeriod.Today,
    description:
      'Calendar days of BUSINESS_TIMEZONE by when the server got the message; not together with createdFrom/createdTo',
  })
  @IsOptional()
  @IsEnum(DayPeriod)
  period?: DayPeriod;

  @ApiPropertyOptional({
    type: String,
    description: 'Received by the server at or after',
  })
  @IsOptional()
  @IsDateFilter()
  createdFrom?: string;

  @ApiPropertyOptional({
    type: String,
    description:
      'Received by the server at or before; earlier than createdFrom is a 400',
  })
  @IsOptional()
  @IsDateFilter()
  @IsNotBelow('createdFrom')
  createdTo?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'The trader' })
  @IsOptional()
  @IsUUID()
  traderUserId?: string;

  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(INT4_MAX)
  deviceId?: number;

  @ApiPropertyOptional({
    maxLength: 100,
    description:
      'A piece of the device name, without case, deleted devices included',
  })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  deviceName?: string;

  @ApiPropertyOptional({
    maxLength: 100,
    description: 'The sender exactly, without case',
  })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  sender?: string;

  @ApiPropertyOptional({
    enum: UnknownSenders,
    default: UnknownSenders.Hide,
    description: 'Senders no active template knew when the message arrived',
  })
  @IsOptional()
  @IsEnum(UnknownSenders)
  unknownSenders?: UnknownSenders;

  @ApiPropertyOptional({ format: 'uuid', description: 'The confirmed deal' })
  @IsOptional()
  @IsUUID()
  transactionId?: string;

  @ApiPropertyOptional({
    maxLength: 100,
    description: 'The message id exactly, or a piece of its text',
  })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  search?: string;
}
