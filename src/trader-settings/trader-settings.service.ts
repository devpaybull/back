import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { AuditService } from '../audit/services/audit.service';
import { ActivityAction } from '../audit/types/activity-action.enum';
import { Crypto } from '../common/types/crypto';
import { formatCrypto } from '../common/utils/format-crypto';
import { toCrypto } from '../common/utils/to-crypto';
import { NotificationSetting } from './entities/notification-setting.entity';
import { TraderSettings } from './entities/trader-settings.entity';
import { NotificationLimitType } from './types/notification-limit-type.enum';
import { NotificationParams } from './types/notification-params';
import { NotificationSettingChange } from './types/notification-setting-change';
import { NotificationSettingState } from './types/notification-setting-state';
import {
  ALWAYS_ON_NOTIFICATIONS,
  NOTIFICATION_TYPES,
  NotificationType,
} from './types/notification-type.enum';
import {
  TraderSettingsAudit,
  TraderSettingsChanges,
} from './types/trader-settings-changes';

const UNIQUE_VIOLATION = '23505';

const UNSAVED_DEFAULTS = {
  tradingEnabled: false,
  payoutTradingEnabled: true,
  withdrawalsEnabled: true,
  maxActivePayouts: null,
  individualRatesEnabled: false,
  autoBuybackEnabled: false,
  autoBuybackConcurrent: null,
  payInAntifraudEnabled: false,
  qrBuybackAccess: false,
  userTransferAccess: false,
  trustedUser: false,
  insurancePayInMin: null,
  insurancePayOutMin: null,
  nightStopEnabled: true,
  nightStopThreshold: null,
} as const;

const ALL_METHODS = 'all';

const isUniqueViolation = (error: unknown): boolean =>
  (error as { code?: unknown } | null)?.code === UNIQUE_VIOLATION;

const FLAG_KEYS = [
  'tradingEnabled',
  'payoutTradingEnabled',
  'withdrawalsEnabled',
  'individualRatesEnabled',
  'payInAntifraudEnabled',
  'qrBuybackAccess',
  'userTransferAccess',
  'trustedUser',
  'nightStopEnabled',
] as const;

@Injectable()
export class TraderSettingsService {
  constructor(
    @InjectRepository(TraderSettings)
    private readonly settings: Repository<TraderSettings>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  async findByUserIds(userIds: string[]): Promise<TraderSettings[]> {
    if (userIds.length === 0) return [];

    return this.settings.find({ where: { userId: In(userIds) } });
  }

  async withdrawalsEnabledWithin(
    manager: EntityManager,
    userId: string,
  ): Promise<boolean> {
    const row = await manager.findOne(TraderSettings, { where: { userId } });

    return row?.withdrawalsEnabled ?? UNSAVED_DEFAULTS.withdrawalsEnabled;
  }

  insurancePayInMinOf(settings: TraderSettings | null | undefined): Crypto {
    return (
      settings?.insurancePayInMin ??
      toCrypto(this.config.get<string>('INSURANCE_PAY_IN_MIN', '0'))
    );
  }

  insurancePayOutMinOf(settings: TraderSettings | null | undefined): Crypto {
    return (
      settings?.insurancePayOutMin ??
      toCrypto(this.config.getOrThrow<string>('INSURANCE_PAY_OUT_MIN'))
    );
  }

  async effectiveInsurancePayOutMin(userId: string): Promise<Crypto> {
    return this.insurancePayOutMinOf(
      await this.settings.findOne({ where: { userId } }),
    );
  }

  nightStopThresholdOf(settings: TraderSettings | null | undefined): number {
    return (
      settings?.nightStopThreshold ??
      this.config.getOrThrow<number>('NIGHT_STOP_THRESHOLD')
    );
  }

  async findOrDefaults(userId: string): Promise<TraderSettings> {
    const existing = await this.settings.findOne({ where: { userId } });

    return existing ?? this.settings.create({ userId, ...UNSAVED_DEFAULTS });
  }

  async ensure(userId: string): Promise<TraderSettings> {
    const existing = await this.settings.findOne({ where: { userId } });
    if (existing) return existing;

    try {
      return await this.settings.save(this.settings.create({ userId }));
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      return this.settings.findOneOrFail({ where: { userId } });
    }
  }

  async update(
    userId: string,
    changes: TraderSettingsChanges,
    audit: TraderSettingsAudit,
  ): Promise<TraderSettings> {
    return this.dataSource.transaction(async (manager) => {
      const settings = await this.ensureWithin(manager, userId);

      const touchedAutoBuyback =
        changes.autoBuybackEnabled !== undefined ||
        changes.autoBuybackConcurrent !== undefined;

      const previousConcurrent = settings.autoBuybackConcurrent;
      const previousEnabled = settings.autoBuybackEnabled;
      const previousTrading = settings.tradingEnabled;

      for (const key of FLAG_KEYS) {
        if (changes[key] !== undefined) settings[key] = changes[key];
      }

      if (changes.insurancePayInMin !== undefined) {
        settings.insurancePayInMin = changes.insurancePayInMin;
      }

      if (changes.insurancePayOutMin !== undefined) {
        settings.insurancePayOutMin = changes.insurancePayOutMin;
      }

      if (changes.maxActivePayouts !== undefined) {
        settings.maxActivePayouts = changes.maxActivePayouts;
      }

      if (changes.nightStopThreshold !== undefined) {
        settings.nightStopThreshold = changes.nightStopThreshold;
      }

      const enabled = changes.autoBuybackEnabled ?? previousEnabled;
      settings.autoBuybackEnabled = enabled;
      settings.autoBuybackConcurrent = enabled
        ? (changes.autoBuybackConcurrent ?? previousConcurrent ?? null)
        : null;

      await manager.save(settings);

      await this.audit.record(
        {
          actorUserId: audit.actorUserId,
          targetUserId: userId,
          action: touchedAutoBuyback
            ? 'trader_settings.auto_buyback_changed'
            : 'trader_settings.updated',
          reason: audit.reason,
          metadata: {
            ...changes,
            ...(changes.insurancePayInMin !== undefined && {
              insurancePayInMin: formatCrypto(changes.insurancePayInMin),
            }),
            ...(changes.insurancePayOutMin !== undefined && {
              insurancePayOutMin: formatCrypto(changes.insurancePayOutMin),
            }),
          },
        },
        manager,
      );

      if (settings.tradingEnabled !== previousTrading) {
        await this.recordActivity(
          manager,
          audit.actorUserId,
          userId,
          settings.tradingEnabled
            ? ActivityAction.TradingEnabled
            : ActivityAction.TradingDisabled,
        );
      }

      if (settings.autoBuybackEnabled !== previousEnabled) {
        await this.recordActivity(
          manager,
          audit.actorUserId,
          userId,
          settings.autoBuybackEnabled
            ? ActivityAction.AutoBuybackEnabled
            : ActivityAction.AutoBuybackDisabled,
        );
      }

      return settings;
    });
  }

  switchTrading(
    userId: string,
    enabled: boolean,
    impersonatorUserId: string | null,
    assertMayEnable: (
      manager: EntityManager,
      settings: TraderSettings,
    ) => Promise<void>,
  ): Promise<TraderSettings> {
    return this.dataSource.transaction(async (manager) => {
      const settings = await this.ensureWithin(manager, userId);

      if (settings.tradingEnabled === enabled) return settings;

      if (enabled) await assertMayEnable(manager, settings);

      settings.tradingEnabled = enabled;
      await manager.save(settings);
      await this.audit.record(
        {
          actorUserId: userId,
          targetUserId: userId,
          action: enabled
            ? ActivityAction.TradingEnabled
            : ActivityAction.TradingDisabled,
          impersonatorUserId,
        },
        manager,
      );

      return settings;
    });
  }

  async notificationSettings(
    userId: string,
  ): Promise<NotificationSettingState[]> {
    return this.notificationStatesOf(
      await this.dataSource.manager.find(NotificationSetting, {
        where: { userId },
      }),
    );
  }

  async updateNotificationSettings(
    userId: string,
    changes: readonly NotificationSettingChange[],
    impersonatorUserId: string | null,
  ): Promise<NotificationSettingState[]> {
    if (new Set(changes.map((change) => change.type)).size !== changes.length) {
      throw new BadRequestException('A notification type is named twice');
    }
    changes.forEach((change) => this.assertParamsFit(change));

    return this.dataSource.transaction(async (manager) => {
      await this.ensureWithin(manager, userId);

      const stored = new Map(
        (await manager.find(NotificationSetting, { where: { userId } })).map(
          (row) => [row.type, row.params],
        ),
      );
      const rows = changes.map((change) => {
        const params = this.notificationParamsOf(
          change,
          stored.get(change.type) ?? null,
        );
        const enabled =
          ALWAYS_ON_NOTIFICATIONS.includes(change.type) || change.enabled;

        if (
          change.type === NotificationType.BalanceBelowThreshold &&
          enabled &&
          !params?.threshold
        ) {
          throw new BadRequestException(
            'balance_below_threshold needs a threshold to be switched on',
          );
        }

        return { userId, type: change.type, enabled, params };
      });

      await manager.upsert(NotificationSetting, rows, ['userId', 'type']);
      await this.audit.record(
        {
          actorUserId: userId,
          impersonatorUserId,
          targetUserId: userId,
          action: 'notification_settings.updated',
          metadata: {
            settings: rows.map((row) => ({
              type: row.type,
              enabled: row.enabled,
              ...row.params,
            })),
          },
        },
        manager,
      );

      return this.notificationStatesOf(
        await manager.find(NotificationSetting, { where: { userId } }),
      );
    });
  }

  private assertParamsFit(change: NotificationSettingChange): void {
    if (
      change.threshold !== undefined &&
      change.type !== NotificationType.BalanceBelowThreshold
    ) {
      throw new BadRequestException(
        `threshold belongs to ${NotificationType.BalanceBelowThreshold} only`,
      );
    }
    if (
      (change.method !== undefined || change.limitType !== undefined) &&
      change.type !== NotificationType.RequisiteLimitReached
    ) {
      throw new BadRequestException(
        `method and limitType belong to ${NotificationType.RequisiteLimitReached} only`,
      );
    }
  }

  private notificationParamsOf(
    change: NotificationSettingChange,
    previous: NotificationParams | null,
  ): NotificationParams | null {
    if (change.type === NotificationType.BalanceBelowThreshold) {
      return {
        threshold:
          change.threshold !== undefined
            ? formatCrypto(change.threshold)
            : (previous?.threshold ?? null),
      };
    }
    if (change.type === NotificationType.RequisiteLimitReached) {
      return {
        method: change.method ?? previous?.method ?? ALL_METHODS,
        limitType:
          change.limitType ?? previous?.limitType ?? NotificationLimitType.All,
      };
    }

    return null;
  }

  private notificationStatesOf(
    rows: readonly NotificationSetting[],
  ): NotificationSettingState[] {
    const byType = new Map(rows.map((row) => [row.type, row]));

    return NOTIFICATION_TYPES.map((type) => {
      const row = byType.get(type);
      const alwaysOn = ALWAYS_ON_NOTIFICATIONS.includes(type);
      const limit = type === NotificationType.RequisiteLimitReached;
      const threshold =
        type === NotificationType.BalanceBelowThreshold
          ? (row?.params?.threshold ?? null)
          : null;

      return {
        type,
        enabled: alwaysOn || (row?.enabled ?? false),
        alwaysOn,
        threshold: threshold === null ? null : toCrypto(threshold),
        method: limit ? (row?.params?.method ?? ALL_METHODS) : null,
        limitType: limit
          ? (row?.params?.limitType ?? NotificationLimitType.All)
          : null,
      };
    });
  }

  private recordActivity(
    manager: EntityManager,
    actorUserId: string,
    targetUserId: string,
    action: ActivityAction,
  ): Promise<unknown> {
    return this.audit.record({ actorUserId, targetUserId, action }, manager);
  }

  private async ensureWithin(
    manager: EntityManager,
    userId: string,
  ): Promise<TraderSettings> {
    const lockedRow = () =>
      manager.findOne(TraderSettings, {
        where: { userId },
        lock: { mode: 'pessimistic_write' },
      });

    const existing = await lockedRow();
    if (existing) return existing;

    await manager
      .createQueryBuilder()
      .insert()
      .into(TraderSettings)
      .values({ userId })
      .orIgnore()
      .execute();

    const created = await lockedRow();
    if (!created) throw new Error(`Trader settings for ${userId} vanished`);

    return created;
  }
}
