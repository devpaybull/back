import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { AuditService } from '../audit/services/audit.service';
import { ActivityAction } from '../audit/types/activity-action.enum';
import { TraderSettings } from './entities/trader-settings.entity';
import {
  TraderSettingsAudit,
  TraderSettingsChanges,
} from './types/trader-settings-changes';

const UNIQUE_VIOLATION = '23505';

const UNSAVED_DEFAULTS = {
  tradingEnabled: false,
  payoutTradingEnabled: false,
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

const isUniqueViolation = (error: unknown): boolean =>
  (error as { code?: unknown } | null)?.code === UNIQUE_VIOLATION;

const FLAG_KEYS = [
  'tradingEnabled',
  'payoutTradingEnabled',
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

  insurancePayInMinOf(settings: TraderSettings | null | undefined): number {
    return (
      settings?.insurancePayInMin ??
      this.config.get<number>('INSURANCE_PAY_IN_MIN', 0)
    );
  }

  async effectiveInsurancePayInMin(userId: string): Promise<number> {
    return this.insurancePayInMinOf(
      await this.settings.findOne({ where: { userId } }),
    );
  }

  insurancePayOutMinOf(settings: TraderSettings | null | undefined): number {
    return (
      settings?.insurancePayOutMin ??
      this.config.getOrThrow<number>('INSURANCE_PAY_OUT_MIN')
    );
  }

  async effectiveInsurancePayOutMin(userId: string): Promise<number> {
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
          metadata: { ...changes },
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
