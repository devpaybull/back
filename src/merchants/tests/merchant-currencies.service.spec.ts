import { BadRequestException, NotFoundException } from '@nestjs/common';
import { In } from 'typeorm';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { MerchantCurrency } from '../entities/merchant-currency.entity';
import { Merchant } from '../entities/merchant.entity';
import { MerchantCurrenciesService } from '../services/merchant-currencies.service';

const MERCHANT = uuidOf(3);
const ACTOR = uuidOf(9);

const currencyRow = (id: number, currencyId: number) =>
  ({
    id,
    merchantId: MERCHANT,
    currencyId,
    payInMarkupPercent: 1,
    payOutMarkupPercent: 2,
  }) as MerchantCurrency;

const build = (
  options: {
    rows?: MerchantCurrency[];
    defaultCurrencyId?: number | null;
    known?: number[];
    merchantExists?: boolean;
  } = {},
) => {
  const rows = options.rows ?? [];
  const settings = { defaultCurrencyId: options.defaultCurrencyId ?? null };
  const manager = {
    find: jest.fn(async () => rows),
    findOne: jest.fn(async () =>
      options.merchantExists === false ? null : { id: MERCHANT },
    ),
    delete: jest.fn(async () => undefined),
    create: jest.fn((_entity: unknown, data: object) => ({ ...data })),
    save: jest.fn(async (saved: unknown) => saved),
  };
  const dataSource = {
    transaction: jest.fn(async (work: (m: typeof manager) => unknown) =>
      work(manager),
    ),
  };
  const repository = { find: jest.fn(async () => rows) };
  const reference = {
    findByIdsWithin: jest.fn(async (_manager: unknown, ids: number[]) =>
      ids
        .filter((id) => (options.known ?? [1, 2, 3]).includes(id))
        .map((id) => ({ id })),
    ),
  };
  const merchantSettings = {
    lockedWithin: jest.fn(async () => settings),
  };
  const audit = { record: jest.fn(async () => undefined) };

  return {
    rows,
    settings,
    manager,
    repository,
    reference,
    merchantSettings,
    audit,
    service: new MerchantCurrenciesService(
      repository as never,
      dataSource as never,
      reference as never,
      merchantSettings as never,
      audit as never,
    ),
  };
};

describe('MerchantCurrenciesService', () => {
  it('reads every merchant’s currencies with the reference row in one query', async () => {
    const { service, repository } = build({ rows: [currencyRow(1, 2)] });

    const result = await service.currenciesByMerchant([MERCHANT, uuidOf(4)]);

    expect(repository.find).toHaveBeenCalledWith({
      where: { merchantId: In([MERCHANT, uuidOf(4)]) },
      relations: { currency: true },
      order: { currencyId: 'ASC' },
    });
    expect(result.get(MERCHANT)).toHaveLength(1);
    expect(result.get(uuidOf(4))).toEqual([]);
  });

  it('refuses an unknown currency with a 400, reading them inside the caller’s transaction', async () => {
    const { service, reference } = build({ known: [1] });
    const manager = {};

    await expect(
      service.assertCurrenciesExistWithin(manager as never, [1, 7]),
    ).rejects.toThrow('Unknown currency 7');
    expect(reference.findByIdsWithin).toHaveBeenCalledWith(manager, [1, 7]);
  });

  describe('replacing the set', () => {
    it('adds the new currencies at zero markup, drops the removed ones and stores the default', async () => {
      const { service, manager, settings } = build({
        rows: [currencyRow(10, 1), currencyRow(11, 2)],
        defaultCurrencyId: 1,
      });

      await service.replaceWithin(manager as never, MERCHANT, {
        currencyIds: [2, 3],
        defaultCurrencyId: 3,
      });

      expect(manager.delete).toHaveBeenCalledWith(MerchantCurrency, {
        id: In([10]),
      });
      expect(manager.create).toHaveBeenCalledWith(MerchantCurrency, {
        merchantId: MERCHANT,
        currencyId: 3,
      });
      expect(settings.defaultCurrencyId).toBe(3);
      expect(manager.save).toHaveBeenCalledWith(settings);
    });

    it('keeps the stored default when only the set changes and the default stays in it', async () => {
      const { service, manager, settings } = build({
        rows: [currencyRow(10, 1)],
        defaultCurrencyId: 1,
      });

      await service.replaceWithin(manager as never, MERCHANT, {
        currencyIds: [1, 2],
      });

      expect(manager.delete).not.toHaveBeenCalled();
      expect(settings.defaultCurrencyId).toBe(1);
    });

    it('refuses a default outside the set with a 400 and writes nothing', async () => {
      const { service, manager } = build({ rows: [currencyRow(10, 1)] });

      await expect(
        service.replaceWithin(manager as never, MERCHANT, {
          currencyIds: [1],
          defaultCurrencyId: 2,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(manager.save).not.toHaveBeenCalled();
      expect(manager.delete).not.toHaveBeenCalled();
    });

    it('refuses removing the stored default without naming a new one', async () => {
      const { service, manager } = build({
        rows: [currencyRow(10, 1), currencyRow(11, 2)],
        defaultCurrencyId: 1,
      });

      await expect(
        service.replaceWithin(manager as never, MERCHANT, { currencyIds: [2] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a set given without any default for a merchant that has none', async () => {
      const { service, manager } = build();

      await expect(
        service.replaceWithin(manager as never, MERCHANT, { currencyIds: [1] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('replacing the markups', () => {
    it('writes the given markups, zeroes the currencies left out and audits in the same transaction', async () => {
      const rows = [currencyRow(10, 1), currencyRow(11, 2)];
      const { service, manager, audit } = build({ rows });

      await service.replaceMarkups(
        MERCHANT,
        [{ currencyId: 1, payInPercent: 1.5, payOutPercent: -0.5 }],
        ACTOR,
      );

      expect(manager.findOne).toHaveBeenCalledWith(Merchant, {
        where: { id: MERCHANT },
        lock: { mode: 'pessimistic_write' },
      });
      expect(rows[0].payInMarkupPercent).toBe(1.5);
      expect(rows[0].payOutMarkupPercent).toBe(-0.5);
      expect(rows[1].payInMarkupPercent).toBe(0);
      expect(rows[1].payOutMarkupPercent).toBe(0);
      expect(audit.record).toHaveBeenCalledWith(
        {
          actorUserId: ACTOR,
          action: 'merchant.markups_replaced',
          metadata: {
            merchantId: MERCHANT,
            markups: [
              { currencyId: 1, payInPercent: 1.5, payOutPercent: -0.5 },
              { currencyId: 2, payInPercent: 0, payOutPercent: 0 },
            ],
          },
        },
        manager,
      );
    });

    it('refuses a currency that is not the merchant’s with a 400', async () => {
      const { service, manager } = build({ rows: [currencyRow(10, 1)] });

      await expect(
        service.replaceMarkups(
          MERCHANT,
          [{ currencyId: 2, payInPercent: 1, payOutPercent: 1 }],
          ACTOR,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('refuses a currency named twice before opening a transaction', async () => {
      const { service, manager } = build({ rows: [currencyRow(10, 1)] });
      const markup = { currencyId: 1, payInPercent: 1, payOutPercent: 1 };

      await expect(
        service.replaceMarkups(MERCHANT, [markup, markup], ACTOR),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(manager.findOne).not.toHaveBeenCalled();
    });

    it('answers 404 for an unknown merchant', async () => {
      const { service } = build({ merchantExists: false });

      await expect(
        service.replaceMarkups(MERCHANT, [], ACTOR),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
