import { toFiat } from '../../common/utils/to-fiat';
import { toRate } from '../../common/utils/to-rate';
import { TransactionKind } from '../types/transaction-kind.enum';
import { computeDeal } from '../utils/compute-deal';
import { computePayOutRequest } from '../utils/compute-pay-out-request';

describe('computePayOutRequest', () => {
  it('prices the merchant side of a pay-out: crypto, the commission on top, the amount held', () => {
    const priced = computePayOutRequest({
      amountFiat: toFiat(10000),
      rate: toRate(100),
      merchantPercent: 10,
    });

    expect(priced.amountCrypto.toFixed(6)).toBe('100.000000');
    expect(priced.merchantCommission.toFixed(6)).toBe('10.000000');
    expect(priced.merchantAmount.toFixed(6)).toBe('110.000000');
  });

  it.each([
    ['5000.00', '92.735000', 3.25],
    ['1234.57', '88.123456', 0],
    ['999999.99', '101.010101', 12.345],
  ])(
    'agrees with computeDeal’s pay-out figures to the last digit (%s at %s, %s%%)',
    (amount, rate, merchantPercent) => {
      const input = {
        amountFiat: toFiat(amount),
        rate: toRate(rate),
        merchantPercent,
      };
      const full = computeDeal({
        ...input,
        kind: TransactionKind.PayOut,
        traderPercent: 5,
        platformMinPercent: 1,
      });
      const priced = computePayOutRequest(input);

      expect(priced.amountCrypto.eq(full.amountCrypto)).toBe(true);
      expect(priced.merchantCommission.eq(full.merchantCommission)).toBe(true);
      expect(priced.merchantAmount.eq(full.merchantAmount)).toBe(true);
    },
  );
});
