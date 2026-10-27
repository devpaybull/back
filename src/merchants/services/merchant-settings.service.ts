import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import Decimal from 'decimal.js';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { Crypto } from '../../common/types/crypto';
import { Fiat } from '../../common/types/fiat';
import { formatCrypto } from '../../common/utils/format-crypto';
import { formatFiat } from '../../common/utils/format-fiat';
import { toCrypto } from '../../common/utils/to-crypto';
import { MerchantIpAddress } from '../entities/merchant-ip-address.entity';
import { MerchantSettings } from '../entities/merchant-settings.entity';
import { Merchant } from '../entities/merchant.entity';
import { MerchantRateCalculation } from '../types/merchant-rate-calculation.enum';
import { MerchantRateSource } from '../types/merchant-rate-source.enum';
import { MerchantSettingsChanges } from '../types/merchant-settings-changes';
import { MerchantSettingsView } from '../types/merchant-settings-view';

const UNSAVED_DEFAULTS: Omit<MerchantSettingsView, 'merchantId'> = {
  defaultCurrencyId: null,
  minPayInAmount: null,
  payInWindowMinutes: null,
  randomizationWindow: 0,
  sameRequestsEnabled: false,
  telegramAlertEnabled: false,
  failedDealsLimitEnabled: false,
  failedDealsPerHour: 5,
  payoutOverdraftEnabled: false,
  autoPayoutEnabled: false,
  autoPayoutAddress: null,
  autoPayoutAmount: null,
  withdrawalFee: toCrypto(0),
  withdrawalFeeWaived: false,
  rateSource: MerchantRateSource.RapiraPlus1,
  rateCalculation: MerchantRateCalculation.ByCrypto,
  callbackUrl: null,
  successUrl: null,
  errorUrl: null,
  supportLink: null,
  ipCheckEnabled: false,
};

const viewOf = (row: MerchantSettings): MerchantSettingsView => ({
  merchantId: row.merchantId,
  defaultCurrencyId: row.defaultCurrencyId,
  minPayInAmount: row.minPayInAmount,
  payInWindowMinutes: row.payInWindowMinutes,
  randomizationWindow: row.randomizationWindow,
  sameRequestsEnabled: row.sameRequestsEnabled,
  telegramAlertEnabled: row.telegramAlertEnabled,
  failedDealsLimitEnabled: row.failedDealsLimitEnabled,
  failedDealsPerHour: row.failedDealsPerHour,
  payoutOverdraftEnabled: row.payoutOverdraftEnabled,
  autoPayoutEnabled: row.autoPayoutEnabled,
  autoPayoutAddress: row.autoPayoutAddress,
  autoPayoutAmount: row.autoPayoutAmount,
  withdrawalFee: row.withdrawalFee,
  withdrawalFeeWaived: row.withdrawalFeeWaived,
  rateSource: row.rateSource,
  rateCalculation: row.rateCalculation,
  callbackUrl: row.callbackUrl,
  successUrl: row.successUrl,
  errorUrl: row.errorUrl,
  supportLink: row.supportLink,
  ipCheckEnabled: row.ipCheckEnabled,
});

const FIAT_KEYS = new Set(['minPayInAmount']);

const auditValue = (key: string, value: unknown): unknown => {
  if (!(value instanceof Decimal)) return value;

  return FIAT_KEYS.has(key)
    ? formatFiat(value as Fiat)
    : formatCrypto(value as Crypto);
};

@Injectable()
export class MerchantSettingsService {
  constructor(
    @InjectRepository(MerchantSettings)
    private readonly settings: Repository<MerchantSettings>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async settingsOf(merchantId: string): Promise<MerchantSettingsView> {
    const row = await this.settings.findOne({ where: { merchantId } });

    return row ? viewOf(row) : { merchantId, ...UNSAVED_DEFAULTS };
  }

  async defaultCurrencyIdsOf(
    merchantIds: string[],
  ): Promise<Map<string, number | null>> {
    const rows = merchantIds.length
      ? await this.settings.find({ where: { merchantId: In(merchantIds) } })
      : [];
    const byMerchant = new Map(
      rows.map((row) => [row.merchantId, row.defaultCurrencyId]),
    );

    return new Map(
      merchantIds.map((merchantId) => [
        merchantId,
        byMerchant.get(merchantId) ?? null,
      ]),
    );
  }

  async allowsOverdraftWithin(
    manager: EntityManager,
    merchantId: string,
  ): Promise<boolean> {
    const row = await manager.findOne(MerchantSettings, {
      where: { merchantId },
      lock: { mode: 'pessimistic_read' },
    });

    return row?.payoutOverdraftEnabled ?? false;
  }

  async update(
    merchantId: string,
    changes: MerchantSettingsChanges,
    actorUserId: string,
  ): Promise<MerchantSettingsView> {
    const written = Object.fromEntries(
      Object.entries(changes).filter(([, value]) => value !== undefined),
    ) as MerchantSettingsChanges;

    if (Object.keys(written).length === 0) {
      throw new BadRequestException('No changes were given');
    }

    await this.dataSource.transaction(async (manager) => {
      const merchant = await manager.findOne(Merchant, {
        where: { id: merchantId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!merchant) throw new NotFoundException('Merchant not found');

      const settings = await this.lockedWithin(manager, merchantId);

      if (written.ipCheckEnabled && !settings.ipCheckEnabled) {
        const addresses = await manager.count(MerchantIpAddress, {
          where: { merchantId },
        });

        if (addresses === 0) {
          throw new BadRequestException(
            'IP checking cannot be switched on with an empty whitelist',
          );
        }
      }

      Object.assign(settings, written);
      await manager.save(settings);

      await this.audit.record(
        {
          actorUserId,
          action: 'merchant.settings_updated',
          metadata: {
            merchantId,
            ...Object.fromEntries(
              Object.entries(written).map(([key, value]) => [
                key,
                auditValue(key, value),
              ]),
            ),
          },
        },
        manager,
      );
    });

    return this.settingsOf(merchantId);
  }

  async lockedWithin(
    manager: EntityManager,
    merchantId: string,
  ): Promise<MerchantSettings> {
    await manager
      .createQueryBuilder()
      .insert()
      .into(MerchantSettings)
      .values({ merchantId })
      .orIgnore()
      .execute();

    return (await manager.findOne(MerchantSettings, {
      where: { merchantId },
      lock: { mode: 'pessimistic_write' },
    })) as MerchantSettings;
  }
}
