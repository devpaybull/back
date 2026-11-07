import { uuidOf } from '../../common/tests/uuid-of.spec';
import { MerchantRatesController } from '../controllers/merchant-rates.controller';

const MERCHANT = uuidOf(30);

describe('MerchantRatesController', () => {
  it('answers the merchant’s rates in force from the rates service', async () => {
    const answer = [{ currencyId: 1, isocode: 'RUB', methods: [] }];
    const rates = { inForce: jest.fn(async () => answer) };

    await expect(
      new MerchantRatesController(rates as never).list(MERCHANT),
    ).resolves.toBe(answer);
    expect(rates.inForce).toHaveBeenCalledWith(MERCHANT);
  });
});
