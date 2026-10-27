import { BadRequestException, NotFoundException } from '@nestjs/common';
import { In } from 'typeorm';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { toCrypto } from '../../common/utils/to-crypto';
import { toFiat } from '../../common/utils/to-fiat';
import { MerchantIpAddress } from '../entities/merchant-ip-address.entity';
import { MerchantSettings } from '../entities/merchant-settings.entity';
import { Merchant } from '../entities/merchant.entity';
import { MerchantSettingsService } from '../services/merchant-settings.service';
import { MerchantRateCalculation } from '../types/merchant-rate-calculation.enum';
import { MerchantRateSource } from '../types/merchant-rate-source.enum';

const MERCHANT = uuidOf(3);
const ACTOR = uuidOf(9);

const build = (
  options: {
    stored?: Partial<MerchantSettings> | null;
    merchantExists?: boolean;
    addresses?: number;
  } = {},
) => {
  const { merchantExists = true, addresses = 0 } = options;
  const row = {
    merchantId: MERCHANT,
    ipCheckEnabled: false,
    ...(options.stored ?? {}),
  } as MerchantSettings;
  const insert = {
    insert: jest.fn(() => insert),
    into: jest.fn(() => insert),
    values: jest.fn(() => insert),
    orIgnore: jest.fn(() => insert),
    execute: jest.fn(async () => undefined),
  };
  const manager = {
    findOne: jest.fn(async (entity: unknown) =>
      entity === Merchant ? (merchantExists ? { id: MERCHANT } : null) : row,
    ),
    count: jest.fn(async () => addresses),
    save: jest.fn(async (saved: unknown) => saved),
    createQueryBuilder: jest.fn(() => insert),
  };
  const dataSource = {
    transaction: jest.fn(async (work: (m: typeof manager) => unknown) =>
      work(manager),
    ),
  };
  const repository = {
    findOne: jest.fn(async () => options.stored ?? null),
    find: jest.fn(async () => (options.stored ? [row] : [])),
  };
  const audit = { record: jest.fn(async () => undefined) };

  return {
    row,
    manager,
    insert,
    repository,
    audit,
    service: new MerchantSettingsService(
      repository as never,
      dataSource as never,
      audit as never,
    ),
  };
};

describe('MerchantSettingsService', () => {
  it('answers the defaults for a merchant whose settings were never saved', async () => {
    const { service } = build();

    expect(await service.settingsOf(MERCHANT)).toEqual({
      merchantId: MERCHANT,
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
    });
  });

  it('reads the overdraft switch inside the caller’s transaction with a share lock, off without a row', async () => {
    const manager = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ payoutOverdraftEnabled: true }),
    };
    const { service } = build();

    expect(
      await service.allowsOverdraftWithin(manager as never, MERCHANT),
    ).toBe(false);
    expect(
      await service.allowsOverdraftWithin(manager as never, MERCHANT),
    ).toBe(true);
    expect(manager.findOne).toHaveBeenCalledWith(MerchantSettings, {
      where: { merchantId: MERCHANT },
      lock: { mode: 'pessimistic_read' },
    });
  });

  it('reads the default currencies in one query, null where nothing is stored', async () => {
    const { service, repository } = build({ stored: { defaultCurrencyId: 4 } });

    const result = await service.defaultCurrencyIdsOf([MERCHANT, uuidOf(5)]);

    expect(repository.find).toHaveBeenCalledWith({
      where: { merchantId: In([MERCHANT, uuidOf(5)]) },
    });
    expect(result.get(MERCHANT)).toBe(4);
    expect(result.get(uuidOf(5))).toBeNull();
  });

  it('creates the row if missing, writes only the given fields under a lock and audits money as strings', async () => {
    const { service, manager, insert, row, audit } = build();

    await service.update(
      MERCHANT,
      {
        minPayInAmount: toFiat('50000'),
        withdrawalFee: toCrypto('1.5'),
        randomizationWindow: 20,
        callbackUrl: undefined,
      },
      ACTOR,
    );

    expect(manager.findOne).toHaveBeenCalledWith(Merchant, {
      where: { id: MERCHANT },
      lock: { mode: 'pessimistic_write' },
    });
    expect(insert.into).toHaveBeenCalledWith(MerchantSettings);
    expect(insert.orIgnore).toHaveBeenCalled();
    expect(manager.findOne).toHaveBeenCalledWith(MerchantSettings, {
      where: { merchantId: MERCHANT },
      lock: { mode: 'pessimistic_write' },
    });
    expect(row.randomizationWindow).toBe(20);
    expect('callbackUrl' in row).toBe(false);
    expect(audit.record).toHaveBeenCalledWith(
      {
        actorUserId: ACTOR,
        action: 'merchant.settings_updated',
        metadata: {
          merchantId: MERCHANT,
          minPayInAmount: '50000.00',
          withdrawalFee: '1.500000',
          randomizationWindow: 20,
        },
      },
      manager,
    );
  });

  it('refuses an empty change with a 400', async () => {
    const { service, manager } = build();

    await expect(
      service.update(MERCHANT, { callbackUrl: undefined }, ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown merchant', async () => {
    const { service, manager } = build({ merchantExists: false });

    await expect(
      service.update(MERCHANT, { sameRequestsEnabled: true }, ACTOR),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('refuses to switch IP checking on with an empty whitelist', async () => {
    const { service, manager } = build({ addresses: 0 });

    await expect(
      service.update(MERCHANT, { ipCheckEnabled: true }, ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.count).toHaveBeenCalledWith(MerchantIpAddress, {
      where: { merchantId: MERCHANT },
    });
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('switches IP checking on when the whitelist has an address', async () => {
    const { service, row } = build({ addresses: 1 });

    await service.update(MERCHANT, { ipCheckEnabled: true }, ACTOR);

    expect(row.ipCheckEnabled).toBe(true);
  });

  it('switches IP checking off without counting', async () => {
    const { service, manager } = build({ stored: { ipCheckEnabled: true } });

    await service.update(MERCHANT, { ipCheckEnabled: false }, ACTOR);

    expect(manager.count).not.toHaveBeenCalled();
  });
});
