import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope-response.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { WriteAccess } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WriteAccessGuard } from '../../common/guards/write-access.guard';
import { AuthenticatedUser } from '../../common/types/token';
import { formatCrypto } from '../../common/utils/format-crypto';
import { toCrypto } from '../../common/utils/to-crypto';
import { TraderSettingsService } from '../../trader-settings/trader-settings.service';
import { NotificationSettingState } from '../../trader-settings/types/notification-setting-state';
import { NotificationSettingDto } from '../dto/notification-setting.dto';
import { UpdateNotificationSettingsDto } from '../dto/update-notification-settings.dto';

const toDto = (state: NotificationSettingState): NotificationSettingDto => ({
  type: state.type,
  enabled: state.enabled,
  alwaysOn: state.alwaysOn,
  threshold: formatCrypto(state.threshold),
  method: state.method,
  limitType: state.limitType,
});

@ApiTags('Trader · Settings')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Trader)
@Controller('trader/notification-settings')
export class TraderNotificationSettingsController {
  constructor(private readonly settings: TraderSettingsService) {}

  @Get()
  @ApiOperation({
    summary: '«Настройки уведомлений»: the twelve switches, always all of them',
    description:
      'Stored only: nothing is sent until the bots exist. Off by default, trading_blocked always on.',
  })
  @ApiEnvelopeResponse(NotificationSettingDto, { isArray: true })
  async list(
    @CurrentUser() trader: AuthenticatedUser,
  ): Promise<NotificationSettingDto[]> {
    return (await this.settings.notificationSettings(trader.id)).map(toDto);
  }

  @Put()
  @WriteAccess()
  @ApiOperation({
    summary: 'Change some of the switches; answers all twelve',
    description:
      'A type named twice, a parameter of another type, or balance_below_threshold switched on with no threshold: 400.',
  })
  @ApiEnvelopeResponse(NotificationSettingDto, { isArray: true })
  async update(
    @CurrentUser() trader: AuthenticatedUser,
    @Body() dto: UpdateNotificationSettingsDto,
  ): Promise<NotificationSettingDto[]> {
    return (
      await this.settings.updateNotificationSettings(
        trader.id,
        dto.settings.map((change) => ({
          type: change.type,
          enabled: change.enabled,
          threshold:
            change.threshold === undefined
              ? undefined
              : toCrypto(change.threshold),
          method: change.method,
          limitType: change.limitType,
        })),
        trader.impersonatedBy ?? null,
      )
    ).map(toDto);
  }
}
