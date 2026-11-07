import { toCrypto } from '../../common/utils/to-crypto';
import { toFiat } from '../../common/utils/to-fiat';
import { toRate } from '../../common/utils/to-rate';
import { TransactionKind } from '../types/transaction-kind.enum';
import { computeDeal } from '../utils/compute-deal';
import { recomputeChangedPayIn } from '../utils/recompute-changed-pay-in';

const deal = {
  rate: toRate('100'),
  merchantPercent: 10,
  traderEffectivePercent: 7,
};

describe('recomputeChangedPayIn', () => {
  it('prices the new amount at the deal’s rate and effective percent', () => {
    const figures = recomputeChangedPayIn(deal, [], toFiat('1500'));
    const fresh = computeDeal({
      kind: TransactionKind.PayIn,
      amountFiat: toFiat('1500'),
      rate: deal.rate,
      merchantPercent: 10,
      traderPercent: 7,
      platformMinPercent: 0,
    });

    expect(figures.amountCrypto).toEqual(toCrypto('15'));
    expect(figures.merchantCommission).toEqual(fresh.merchantCommission);
    expect(figures.traderCommission).toEqual(fresh.traderCommission);
    expect(figures.traderAmount).toEqual(fresh.traderAmount);
    expect(figures.merchantAmount).toEqual(toCrypto('13.5'));
    expect(figures.leadCommission).toBeNull();
    expect(figures.leadShares).toEqual([]);
  });

  it('recomputes each lead share from its own percent and sums them', () => {
    const figures = recomputeChangedPayIn(
      deal,
      [
        { id: 1, percent: 1 },
        { id: 2, percent: 0.5 },
      ],
      toFiat('2000'),
    );

    expect(figures.leadShares).toEqual([
      { shareId: 1, amount: toCrypto('0.2') },
      { shareId: 2, amount: toCrypto('0.1') },
    ]);
    expect(figures.leadCommission).toEqual(toCrypto('0.3'));
  });

  it('keeps the trader’s effective percent: the platform minimum is not applied a second time', () => {
    const lowMargin = {
      rate: toRate('100'),
      merchantPercent: 3,
      traderEffectivePercent: 3,
    };

    const figures = recomputeChangedPayIn(
      lowMargin,
      [{ id: 1, percent: 2 }],
      toFiat('1000'),
    );

    expect(figures.traderAmount).toEqual(
      computeDeal({
        kind: TransactionKind.PayIn,
        amountFiat: toFiat('1000'),
        rate: lowMargin.rate,
        merchantPercent: 3,
        traderPercent: 3,
        platformMinPercent: 0,
      }).traderAmount,
    );
  });
});
