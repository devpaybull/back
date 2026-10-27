import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { AuditService } from '../../audit/services/audit.service';
import { CurrenciesService } from '../../currencies/currencies.service';
import { MerchantCurrency } from '../entities/merchant-currency.entity';
import { Merchant } from '../entities/merchant.entity';
import { MerchantCurrencyChange } from '../types/merchant-currency-change';
import { MerchantMarkup } from '../types/merchant-markup';
import { MerchantSettingsService } from './merchant-settings.service';

@Injectable()
export class MerchantCurrenciesService {
  constructor(
    @InjectRepository(MerchantCurrency)
    private readonly currencies: Repository<MerchantCurrency>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly reference: CurrenciesService,
    private readonly settings: MerchantSettingsService,
    private readonly audit: AuditService,
  ) {}

  async currenciesByMerchant(
    merchantIds: string[],
  ): Promise<Map<string, MerchantCurrency[]>> {
    const rows = merchantIds.length
      ? await this.currencies.find({
          where: { merchantId: In(merchantIds) },
          relations: { currency: true },
          order: { currencyId: 'ASC' },
        })
      : [];

    return new Map(
      merchantIds.map((merchantId) => [
        merchantId,
        rows.filter((row) => row.merchantId === merchantId),
      ]),
    );
  }

  async assertCurrenciesExistWithin(
    manager: EntityManager,
    currencyIds: number[],
  ): Promise<void> {
    const found = new Set(
      (
        await this.reference.findByIdsWithin(manager, [...new Set(currencyIds)])
      ).map((currency) => currency.id),
    );
    const missing = currencyIds.filter((id) => !found.has(id));

    if (missing.length) {
      throw new BadRequestException(
        `Unknown currency ${[...new Set(missing)].join(', ')}`,
      );
    }
  }

  async replaceWithin(
    manager: EntityManager,
    merchantId: string,
    change: MerchantCurrencyChange,
  ): Promise<void> {
    const current = await manager.find(MerchantCurrency, {
      where: { merchantId },
    });
    const settings = await this.settings.lockedWithin(manager, merchantId);
    const currentIds = current.map((row) => row.currencyId);
    const nextIds = change.currencyIds ?? currentIds;
    const nextDefault = change.defaultCurrencyId ?? settings.defaultCurrencyId;

    if (nextDefault === null || !nextIds.includes(nextDefault)) {
      throw new BadRequestException(
        'defaultCurrencyId must be one of the merchant’s currencies',
      );
    }

    const removed = current.filter((row) => !nextIds.includes(row.currencyId));
    const added = nextIds.filter((id) => !currentIds.includes(id));

    if (removed.length) {
      await manager.delete(MerchantCurrency, {
        id: In(removed.map((row) => row.id)),
      });
    }

    if (added.length) {
      await manager.save(
        added.map((currencyId) =>
          manager.create(MerchantCurrency, { merchantId, currencyId }),
        ),
      );
    }

    settings.defaultCurrencyId = nextDefault;
    await manager.save(settings);
  }

  async replaceMarkups(
    merchantId: string,
    markups: MerchantMarkup[],
    actorUserId: string,
  ): Promise<MerchantCurrency[]> {
    const ids = markups.map((markup) => markup.currencyId);

    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException(
        'A currency appears more than once in the set',
      );
    }

    await this.dataSource.transaction(async (manager) => {
      const merchant = await manager.findOne(Merchant, {
        where: { id: merchantId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!merchant) throw new NotFoundException('Merchant not found');

      const rows = await manager.find(MerchantCurrency, {
        where: { merchantId },
      });
      const owned = new Set(rows.map((row) => row.currencyId));
      const foreign = ids.filter((id) => !owned.has(id));

      if (foreign.length) {
        throw new BadRequestException(
          `Currency ${foreign.join(', ')} is not one of the merchant’s currencies`,
        );
      }

      const byCurrency = new Map(
        markups.map((markup) => [markup.currencyId, markup]),
      );

      for (const row of rows) {
        const markup = byCurrency.get(row.currencyId);

        row.payInMarkupPercent = markup?.payInPercent ?? 0;
        row.payOutMarkupPercent = markup?.payOutPercent ?? 0;
      }

      await manager.save(rows);

      await this.audit.record(
        {
          actorUserId,
          action: 'merchant.markups_replaced',
          metadata: {
            merchantId,
            markups: rows.map((row) => ({
              currencyId: row.currencyId,
              payInPercent: row.payInMarkupPercent,
              payOutPercent: row.payOutMarkupPercent,
            })),
          },
        },
        manager,
      );
    });

    return (await this.currenciesByMerchant([merchantId])).get(
      merchantId,
    ) as MerchantCurrency[];
  }
}
