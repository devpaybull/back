import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsCryptoAmount } from '../../common/decorators/is-crypto-amount.decorator';
import { NotificationLimitType } from '../../trader-settings/types/notification-limit-type.enum';
import {
  NOTIFICATION_TYPES,
  NotificationType,
} from '../../trader-settings/types/notification-type.enum';
import { TRANSACTION_METHOD_CODES } from '../../transactions/utils/transaction-methods';

const LIMIT_METHODS = [...TRANSACTION_METHOD_CODES, 'all'];

const sent = (_: object, value: unknown): boolean => value !== undefined;

export class NotificationSettingChangeDto {
  @ApiProperty({ enum: NotificationType })
  @IsEnum(NotificationType)
  type: NotificationType;

  @ApiProperty({
    description: 'trading_blocked stays on whatever is sent',
  })
  @IsBoolean()
  enabled: boolean;

  @ApiPropertyOptional({
    type: String,
    example: '100.00',
    description:
      'USDT, above zero; balance_below_threshold only, and required to switch it on',
  })
  @ValidateIf(sent)
  @IsCryptoAmount({ positive: true })
  threshold?: string;

  @ApiPropertyOptional({
    enum: LIMIT_METHODS,
    description: 'requisite_limit_reached only; kept when absent, all at first',
  })
  @ValidateIf(sent)
  @IsIn(LIMIT_METHODS)
  method?: string;

  @ApiPropertyOptional({
    enum: NotificationLimitType,
    description: 'requisite_limit_reached only; kept when absent, all at first',
  })
  @ValidateIf(sent)
  @IsEnum(NotificationLimitType)
  limitType?: NotificationLimitType;
}

export class UpdateNotificationSettingsDto {
  @ApiProperty({
    type: [NotificationSettingChangeDto],
    description:
      'The types to change, each at most once; the ones not named keep their state',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(NOTIFICATION_TYPES.length)
  @ValidateNested({ each: true })
  @Type(() => NotificationSettingChangeDto)
  settings: NotificationSettingChangeDto[];
}
