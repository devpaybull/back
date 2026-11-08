import { ApiProperty } from '@nestjs/swagger';
import { NotificationLimitType } from '../../trader-settings/types/notification-limit-type.enum';
import { NotificationType } from '../../trader-settings/types/notification-type.enum';

export class NotificationSettingDto {
  @ApiProperty({ enum: NotificationType })
  type: NotificationType;

  @ApiProperty({ description: 'Off by default; trading_blocked is always on' })
  enabled: boolean;

  @ApiProperty({
    description: 'trading_blocked: the switch cannot be turned off',
  })
  alwaysOn: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '100.000000',
    description: 'USDT; balance_below_threshold only',
  })
  threshold: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'all',
    description:
      'A method of the registry or all; requisite_limit_reached only',
  })
  method: string | null;

  @ApiProperty({
    enum: NotificationLimitType,
    nullable: true,
    description: 'requisite_limit_reached only',
  })
  limitType: NotificationLimitType | null;
}
