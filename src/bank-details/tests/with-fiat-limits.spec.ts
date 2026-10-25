import { toFiat } from '../../common/utils/to-fiat';
import { withFiatLimits } from '../utils/with-fiat-limits';

describe('withFiatLimits', () => {
  it('turns every amount limit string into an exact fiat amount', () => {
    expect(
      withFiatLimits({
        minAmount: '500.50',
        maxAmount: '100000',
        dailyAmountLimit: '0',
        monthlyAmountLimit: '2500000.99',
      }),
    ).toEqual({
      minAmount: toFiat('500.50'),
      maxAmount: toFiat('100000'),
      dailyAmountLimit: toFiat('0'),
      monthlyAmountLimit: toFiat('2500000.99'),
    });
  });

  it('leaves absent and null limits and every other field as they were', () => {
    expect(
      withFiatLimits({
        minAmount: null,
        dailyLimit: 3,
        minAmountEnabled: false,
        card: '4111',
      }),
    ).toEqual({
      minAmount: null,
      dailyLimit: 3,
      minAmountEnabled: false,
      card: '4111',
    });
  });
});
