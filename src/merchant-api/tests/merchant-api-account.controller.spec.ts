import { ServiceUnavailableException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PUBLIC_METADATA_KEY } from '../../common/decorators/public.decorator';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { toCrypto } from '../../common/utils/to-crypto';
import { toRate } from '../../common/utils/to-rate';
import { MerchantApiAccountController } from '../controllers/merchant-api-account.controller';
import { MerchantApiKeyGuard } from '../guards/merchant-api-key.guard';

const MERCHANT = uuidOf(1);

describe('MerchantApiAccountController', () => {
  it('is public for the JWT guard and closed by the API key guard', () => {
    expect(
      Reflect.getMetadata(PUBLIC_METADATA_KEY, MerchantApiAccountController),
    ).toBe(true);
    expect(
      Reflect.getMetadata(GUARDS_METADATA, MerchantApiAccountController),
    ).toEqual([MerchantApiKeyGuard]);
  });

  it('answers the available balance and the escrow as crypto strings in USDT', async () => {
    const balances = {
      statesByMerchant: jest.fn(
        async () =>
          new Map([
            [
              MERCHANT,
              {
                balance: toCrypto('1500.5'),
                escrow: toCrypto('20'),
                withdrawalReserved: toCrypto('7'),
              },
            ],
          ]),
      ),
    };
    const controller = new MerchantApiAccountController(
      balances as never,
      {} as never,
    );

    await expect(
      controller.balance({ merchantId: MERCHANT, apiKeyId: 1 }),
    ).resolves.toEqual({
      available: '1500.500000',
      escrow: '20.000000',
      currency: 'USDT',
    });
    expect(balances.statesByMerchant).toHaveBeenCalledWith([MERCHANT]);
  });

  it('answers the exchange rates as rate strings', async () => {
    const rates = {
      exchangeRates: jest.fn(async () => [
        { currency: 'RUB', type: 'pay_in', rate: toRate('92.718') },
        { currency: 'RUB', type: 'pay_out', rate: toRate('89.5365') },
      ]),
    };
    const controller = new MerchantApiAccountController(
      {} as never,
      rates as never,
    );

    await expect(
      controller.exchangeRates({ merchantId: MERCHANT, apiKeyId: 1 }),
    ).resolves.toEqual([
      { currency: 'RUB', type: 'pay_in', rate: '92.718000' },
      { currency: 'RUB', type: 'pay_out', rate: '89.536500' },
    ]);
    expect(rates.exchangeRates).toHaveBeenCalledWith(MERCHANT);
  });

  it('turns a rate source with no rate at all into 503 RATE_UNAVAILABLE', async () => {
    const controller = new MerchantApiAccountController(
      {} as never,
      {
        exchangeRates: jest.fn(async () => {
          throw new ServiceUnavailableException('down');
        }),
      } as never,
    );

    const error = await controller
      .exchangeRates({ merchantId: MERCHANT, apiKeyId: 1 })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getResponse()).toEqual({
      code: 'RATE_UNAVAILABLE',
      message: 'The exchange rate is unavailable',
    });
  });

  it('answers the methods in force from the rates service', async () => {
    const answer = [{ currencyId: 1, isocode: 'RUB', methods: [] }];
    const rates = { inForce: jest.fn(async () => answer) };
    const controller = new MerchantApiAccountController(
      {} as never,
      rates as never,
    );

    await expect(
      controller.methods({ merchantId: MERCHANT, apiKeyId: 1 }),
    ).resolves.toBe(answer);
    expect(rates.inForce).toHaveBeenCalledWith(MERCHANT);
  });
});
