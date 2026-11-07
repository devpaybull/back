import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PUBLIC_METADATA_KEY } from '../../common/decorators/public.decorator';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { toCrypto } from '../../common/utils/to-crypto';
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
    const controller = new MerchantApiAccountController(balances as never);

    await expect(
      controller.balance({ merchantId: MERCHANT, apiKeyId: 1 }),
    ).resolves.toEqual({
      available: '1500.500000',
      escrow: '20.000000',
      currency: 'USDT',
    });
    expect(balances.statesByMerchant).toHaveBeenCalledWith([MERCHANT]);
  });
});
