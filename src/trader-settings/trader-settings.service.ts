import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { TraderSettings } from './entities/trader-settings.entity';
import {
  TraderSettingsAudit,
  TraderSettingsChanges,
} from './types/trader-settings-changes';

const FLAG_KEYS = [
  'tradingEnabled',
  'payoutTradingEnabled',
  'individualRatesEnabled',
  'payInAntifraudEnabled',
  'qrBuybackAccess',
  'userTransferAccess',
  'trustedUser',
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

  async ensure(userId: string): Promise<TraderSettings> {
    const existing = await this.settings.findOne({ where: { userId } });
    if (existing) return existing;

    return this.settings.save(this.settings.create({ userId }));
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

      for (const key of FLAG_KEYS) {
        if (changes[key] !== undefined) settings[key] = changes[key];
      }

      if (changes.insurancePayInMin !== undefined) {
        settings.insurancePayInMin = changes.insurancePayInMin;
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

      return settings;
    });
  }

  private async ensureWithin(
    manager: EntityManager,
    userId: string,
  ): Promise<TraderSettings> {
    const existing = await manager.findOne(TraderSettings, {
      where: { userId },
    });
    if (existing) return existing;

    return manager.save(manager.create(TraderSettings, { userId }));
  }
}
