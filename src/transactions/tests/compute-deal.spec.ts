import { TransactionKind } from '../types/transaction-kind.enum';
import { computeDeal } from '../utils/compute-deal';

describe('computeDeal', () => {
  describe('pay-in (plan section 5, example 1)', () => {
    const result = computeDeal({
      kind: TransactionKind.PayIn,
      amountFiat: 26262,
      rate: 88.92,
      merchantPercent: 10.5,
      traderPercent: 8.5,
    });

    it('crypto = amount / rate', () => {
      expect(result.amountCrypto).toBe(295.344);
    });

    it('merchant commission = crypto × merchantPercent', () => {
      expect(result.merchantCommission).toBe(31.011);
    });

    it('merchant receives crypto − merchantCommission', () => {
      expect(result.merchantAmount).toBe(264.333);
    });

    it('trader is charged amount / (rate × (1 + traderPercent))', () => {
      expect(result.traderAmount).toBe(272.207);
    });

    it('trader earns |crypto − traderAmount|', () => {
      expect(result.traderCommission).toBe(23.137);
    });

    it('leaves the platform margin as merchantAmount vs traderAmount', () => {
      expect(result.traderAmount - result.merchantAmount).toBeCloseTo(7.874, 3);
    });
  });

  describe('pay-out (plan section 5, example 2)', () => {
    const result = computeDeal({
      kind: TransactionKind.PayOut,
      amountFiat: 40000,
      rate: 89.05,
      merchantPercent: 3,
      traderPercent: 1.5,
    });

    it('crypto = amount / rate', () => {
      expect(result.amountCrypto).toBe(449.186);
    });

    it('merchant commission = crypto × merchantPercent', () => {
      expect(result.merchantCommission).toBe(13.476);
    });

    it('trader earns crypto × traderPercent', () => {
      expect(result.traderCommission).toBe(6.738);
    });

    it('trader is credited crypto + traderCommission', () => {
      expect(result.traderAmount).toBe(455.924);
    });

    it('merchant is charged crypto + merchantCommission (round-each convention)', () => {
      expect(result.merchantAmount).toBe(462.662);
    });
  });

  describe('lead commission', () => {
    it('is null when no lead percent is supplied', () => {
      const result = computeDeal({
        kind: TransactionKind.PayIn,
        amountFiat: 26262,
        rate: 88.92,
        merchantPercent: 10.5,
        traderPercent: 8.5,
      });
      expect(result.leadCommission).toBeNull();
    });

    it('is crypto × leadPercent when supplied', () => {
      const result = computeDeal({
        kind: TransactionKind.PayIn,
        amountFiat: 26262,
        rate: 88.92,
        merchantPercent: 10.5,
        traderPercent: 8.5,
        leadPercent: 2,
      });
      expect(result.leadCommission).toBe(5.907);
    });
  });
});
