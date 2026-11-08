import { ROLES_METADATA_KEY } from '../../common/decorators/roles.decorator';
import { WRITE_ACCESS_METADATA_KEY } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { AuthenticatedUser } from '../../common/types/token';
import { toCrypto } from '../../common/utils/to-crypto';
import { NotificationLimitType } from '../../trader-settings/types/notification-limit-type.enum';
import { NotificationType } from '../../trader-settings/types/notification-type.enum';
import { UserStatus } from '../../users/types/user-status.enum';
import { TraderNotificationSettingsController } from '../controllers/trader-notification-settings.controller';

const trader: AuthenticatedUser = {
  id: uuidOf(1),
  login: 'trader',
  role: Role.Trader,
  status: UserStatus.Active,
  impersonatedBy: uuidOf(9),
};

const states = [
  {
    type: NotificationType.BalanceBelowThreshold,
    enabled: true,
    alwaysOn: false,
    threshold: toCrypto('100.5'),
    method: null,
    limitType: null,
  },
  {
    type: NotificationType.RequisiteLimitReached,
    enabled: false,
    alwaysOn: false,
    threshold: null,
    method: 'all',
    limitType: NotificationLimitType.All,
  },
];

const build = () => {
  const settings = {
    notificationSettings: jest.fn(async () => states),
    updateNotificationSettings: jest.fn(async () => states),
  };

  return {
    settings,
    controller: new TraderNotificationSettingsController(settings as never),
  };
};

describe('TraderNotificationSettingsController', () => {
  it('is the trader’s alone, and the write is marked', () => {
    expect(
      Reflect.getMetadata(
        ROLES_METADATA_KEY,
        TraderNotificationSettingsController,
      ),
    ).toEqual([Role.Trader]);
    expect(
      Reflect.getMetadata(
        WRITE_ACCESS_METADATA_KEY,
        TraderNotificationSettingsController.prototype.update,
      ),
    ).toBe(true);
  });

  it('renders the threshold as a USDT string', async () => {
    const { controller } = build();

    expect(await controller.list(trader)).toEqual([
      {
        type: NotificationType.BalanceBelowThreshold,
        enabled: true,
        alwaysOn: false,
        threshold: '100.500000',
        method: null,
        limitType: null,
      },
      {
        type: NotificationType.RequisiteLimitReached,
        enabled: false,
        alwaysOn: false,
        threshold: null,
        method: 'all',
        limitType: NotificationLimitType.All,
      },
    ]);
  });

  it('hands the changes over typed, with the impersonator', async () => {
    const { controller, settings } = build();

    await controller.update(trader, {
      settings: [
        {
          type: NotificationType.BalanceBelowThreshold,
          enabled: true,
          threshold: '100.50',
        },
        { type: NotificationType.NewPayouts, enabled: false },
      ],
    });

    expect(settings.updateNotificationSettings).toHaveBeenCalledWith(
      trader.id,
      [
        {
          type: NotificationType.BalanceBelowThreshold,
          enabled: true,
          threshold: toCrypto('100.5'),
          method: undefined,
          limitType: undefined,
        },
        {
          type: NotificationType.NewPayouts,
          enabled: false,
          threshold: undefined,
          method: undefined,
          limitType: undefined,
        },
      ],
      uuidOf(9),
    );
  });
});
