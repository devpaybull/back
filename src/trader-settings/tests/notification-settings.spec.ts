import { uuidOf } from '../../common/tests/uuid-of.spec';
import { toCrypto } from '../../common/utils/to-crypto';
import { NotificationSetting } from '../entities/notification-setting.entity';
import { TraderSettings } from '../entities/trader-settings.entity';
import { TraderSettingsService } from '../trader-settings.service';
import { NotificationLimitType } from '../types/notification-limit-type.enum';
import { NotificationType } from '../types/notification-type.enum';

describe('TraderSettingsService: notification settings (TC12)', () => {
  const TRADER = uuidOf(1);
  let rows: Partial<NotificationSetting>[];
  let manager: {
    find: jest.Mock;
    findOne: jest.Mock;
    upsert: jest.Mock;
  };
  let audit: { record: jest.Mock };
  let service: TraderSettingsService;

  beforeEach(() => {
    rows = [];
    manager = {
      find: jest.fn(async () => rows),
      findOne: jest.fn(async () => ({ id: 1, userId: TRADER })),
      upsert: jest.fn(
        async (_entity, values: Partial<NotificationSetting>[]) => {
          for (const value of values) {
            rows = [...rows.filter((row) => row.type !== value.type), value];
          }
        },
      ),
    };
    audit = { record: jest.fn(async () => undefined) };
    service = new TraderSettingsService(
      {} as never,
      {
        manager,
        transaction: jest.fn(async (work) => work(manager)),
      } as never,
      audit as never,
      { get: jest.fn() } as never,
    );
  });

  const stateOf = async (type: NotificationType) =>
    (await service.notificationSettings(TRADER)).find(
      (state) => state.type === type,
    );

  it('answers all twelve in a fixed order, off by default and trading_blocked always on', async () => {
    const states = await service.notificationSettings(TRADER);

    expect(states.map((state) => state.type)).toEqual(
      Object.values(NotificationType),
    );
    expect(states).toHaveLength(12);
    expect(
      states.filter((state) => state.enabled).map((state) => state.type),
    ).toEqual([NotificationType.TradingBlocked]);
    expect(await stateOf(NotificationType.TradingBlocked)).toMatchObject({
      enabled: true,
      alwaysOn: true,
    });
    expect(await stateOf(NotificationType.RequisiteLimitReached)).toEqual({
      type: NotificationType.RequisiteLimitReached,
      enabled: false,
      alwaysOn: false,
      threshold: null,
      method: 'all',
      limitType: NotificationLimitType.All,
    });
    expect(manager.find).toHaveBeenCalledWith(NotificationSetting, {
      where: { userId: TRADER },
    });
  });

  it('stores the switches sent, under the settings row lock, with an audit row, and answers all twelve', async () => {
    const states = await service.updateNotificationSettings(
      TRADER,
      [
        {
          type: NotificationType.BalanceBelowThreshold,
          enabled: true,
          threshold: toCrypto('100.5'),
        },
        {
          type: NotificationType.RequisiteLimitReached,
          enabled: true,
          method: 'sbp',
          limitType: NotificationLimitType.Hourly,
        },
        { type: NotificationType.NewPayouts, enabled: true },
      ],
      uuidOf(9),
    );

    expect(manager.findOne).toHaveBeenCalledWith(TraderSettings, {
      where: { userId: TRADER },
      lock: { mode: 'pessimistic_write' },
    });
    expect(manager.upsert).toHaveBeenCalledWith(
      NotificationSetting,
      [
        {
          userId: TRADER,
          type: NotificationType.BalanceBelowThreshold,
          enabled: true,
          params: { threshold: '100.500000' },
        },
        {
          userId: TRADER,
          type: NotificationType.RequisiteLimitReached,
          enabled: true,
          params: { method: 'sbp', limitType: NotificationLimitType.Hourly },
        },
        {
          userId: TRADER,
          type: NotificationType.NewPayouts,
          enabled: true,
          params: null,
        },
      ],
      ['userId', 'type'],
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: TRADER,
        impersonatorUserId: uuidOf(9),
        targetUserId: TRADER,
        action: 'notification_settings.updated',
      }),
      manager,
    );
    expect(states).toHaveLength(12);
    expect(
      states.find(
        (state) => state.type === NotificationType.BalanceBelowThreshold,
      ),
    ).toMatchObject({ enabled: true, threshold: toCrypto('100.5') });
  });

  it('keeps the stored parameters when a change omits them', async () => {
    rows = [
      {
        userId: TRADER,
        type: NotificationType.BalanceBelowThreshold,
        enabled: true,
        params: { threshold: '50.000000' },
      },
      {
        userId: TRADER,
        type: NotificationType.RequisiteLimitReached,
        enabled: false,
        params: { method: 'card', limitType: NotificationLimitType.Daily },
      },
    ];

    await service.updateNotificationSettings(
      TRADER,
      [
        { type: NotificationType.BalanceBelowThreshold, enabled: false },
        {
          type: NotificationType.RequisiteLimitReached,
          enabled: true,
          limitType: NotificationLimitType.ActiveDeals,
        },
      ],
      null,
    );

    expect(await stateOf(NotificationType.BalanceBelowThreshold)).toMatchObject(
      { enabled: false, threshold: toCrypto(50) },
    );
    expect(await stateOf(NotificationType.RequisiteLimitReached)).toMatchObject(
      {
        enabled: true,
        method: 'card',
        limitType: NotificationLimitType.ActiveDeals,
      },
    );
  });

  it('keeps trading_blocked on whatever is sent', async () => {
    await service.updateNotificationSettings(
      TRADER,
      [{ type: NotificationType.TradingBlocked, enabled: false }],
      null,
    );

    expect(manager.upsert.mock.calls[0][1]).toEqual([
      expect.objectContaining({
        type: NotificationType.TradingBlocked,
        enabled: true,
      }),
    ]);
  });

  it('refuses with a 400, writing nothing: a type twice, a parameter of another type, the threshold switch on with no threshold', async () => {
    const refused = [
      [
        { type: NotificationType.NewPayouts, enabled: true },
        { type: NotificationType.NewPayouts, enabled: false },
      ],
      [
        {
          type: NotificationType.NewPayouts,
          enabled: true,
          threshold: toCrypto(1),
        },
      ],
      [{ type: NotificationType.DeviceOffline, enabled: true, method: 'sbp' }],
      [
        {
          type: NotificationType.BalanceBelowThreshold,
          enabled: false,
          limitType: NotificationLimitType.Daily,
        },
      ],
      [{ type: NotificationType.BalanceBelowThreshold, enabled: true }],
    ];

    for (const changes of refused) {
      await expect(
        service.updateNotificationSettings(TRADER, changes, null),
      ).rejects.toMatchObject({ status: 400 });
    }
    expect(manager.upsert).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});
