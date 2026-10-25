import { TransactionKind } from '../types/transaction-kind.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import {
  computeDeal,
  PlatformMinimumUnreachableError,
} from '../utils/compute-deal';

const LEAD_A = uuidOf(21);
const LEAD_B = uuidOf(22);
const DEAL_KINDS = [TransactionKind.PayIn, TransactionKind.PayOut] as const;

describe('computeDeal', () => {
  describe('pay-in (plan section 5, example 1)', () => {
    const result = computeDeal({
      kind: TransactionKind.PayIn,
      amountFiat: 26262,
      rate: 88.92,
      merchantPercent: 10.5,
      traderPercent: 8.5,
      platformMinPercent: 0,
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
      platformMinPercent: 0,
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
        platformMinPercent: 0,
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
        platformMinPercent: 0,
        leads: [{ leadUserId: LEAD_A, percent: 2 }],
      });
      expect(result.leadCommission).toBe(5.907);
      expect(result.leadShares).toEqual([
        { leadUserId: LEAD_A, percent: 2, amount: 5.907 },
      ]);
    });
  });

  describe('the platform minimum and the lead shares (spec 08)', () => {
    const ownerExample = (
      kind: TransactionKind.PayIn | TransactionKind.PayOut,
    ) =>
      computeDeal({
        kind,
        amountFiat: 10000,
        rate: 100,
        merchantPercent: 10,
        traderPercent: 7,
        platformMinPercent: 1,
        leads: [{ leadUserId: LEAD_A, percent: 2.5 }],
      });

    describe.each(DEAL_KINDS)(
      'the owner example 10 / 7 / 2.5 / 1 on a %s',
      (kind) => {
        const result = ownerExample(kind);

        it('takes the 0.5 shortfall off the trader: 6.5', () => {
          expect(result.shortfallPercent).toBe(0.5);
          expect(result.traderEffectivePercent).toBe(6.5);
        });

        it('leaves the lead its full 2.5', () => {
          expect(result.leadPercent).toBe(2.5);
          expect(result.leadShares).toEqual([
            { leadUserId: LEAD_A, percent: 2.5, amount: 2.5 },
          ]);
          expect(result.leadCommission).toBe(2.5);
        });

        it('leaves the platform exactly its minimum of 1', () => {
          expect(
            10 - result.traderEffectivePercent - (result.leadPercent as number),
          ).toBeCloseTo(1, 9);
        });
      },
    );

    it('prices the pay-in trader at the effective 6.5', () => {
      const result = ownerExample(TransactionKind.PayIn);

      expect(result.traderAmount).toBe(93.897);
      expect(result.traderCommission).toBe(6.103);
      expect(result.merchantAmount).toBe(90);
    });

    it('credits the pay-out trader crypto + 6.5%', () => {
      const result = ownerExample(TransactionKind.PayOut);

      expect(result.traderCommission).toBe(6.5);
      expect(result.traderAmount).toBe(106.5);
      expect(result.merchantAmount).toBe(110);
    });

    it('takes nothing off the trader when the margin covers the leads and the minimum', () => {
      const result = computeDeal({
        kind: TransactionKind.PayIn,
        amountFiat: 10000,
        rate: 100,
        merchantPercent: 10,
        traderPercent: 7,
        platformMinPercent: 1,
        leads: [{ leadUserId: LEAD_A, percent: 1.5 }],
      });

      expect(result.shortfallPercent).toBe(0);
      expect(result.traderEffectivePercent).toBe(7);
    });

    it('subtracts the sum of every lead rate from the margin', () => {
      const result = computeDeal({
        kind: TransactionKind.PayOut,
        amountFiat: 10000,
        rate: 100,
        merchantPercent: 10,
        traderPercent: 7,
        platformMinPercent: 1,
        leads: [
          { leadUserId: LEAD_A, percent: 1.5 },
          { leadUserId: LEAD_B, percent: 1 },
        ],
      });

      expect(result.leadPercent).toBe(2.5);
      expect(result.shortfallPercent).toBe(0.5);
      expect(result.traderEffectivePercent).toBe(6.5);
      expect(result.leadShares).toEqual([
        { leadUserId: LEAD_A, percent: 1.5, amount: 1.5 },
        { leadUserId: LEAD_B, percent: 1, amount: 1 },
      ]);
      expect(result.leadCommission).toBe(2.5);
    });

    it.each(DEAL_KINDS)(
      'takes no shortfall and never refuses a %s with no leads, even under the minimum',
      (kind) => {
        const result = computeDeal({
          kind,
          amountFiat: 10000,
          rate: 100,
          merchantPercent: 10,
          traderPercent: 9.5,
          platformMinPercent: 1,
        });

        expect(result.shortfallPercent).toBe(0);
        expect(result.traderEffectivePercent).toBe(9.5);
        expect(result.leadPercent).toBeNull();
        expect(result.leadShares).toEqual([]);
      },
    );

    it('does not refuse with no leads when merchant minus trader is below the minimum', () => {
      expect(() =>
        computeDeal({
          kind: TransactionKind.PayIn,
          amountFiat: 10000,
          rate: 100,
          merchantPercent: 10,
          traderPercent: 10,
          platformMinPercent: 1,
        }),
      ).not.toThrow();
    });

    it('with one lead leaves the owner example unchanged: trader 6.5', () => {
      const result = ownerExample(TransactionKind.PayIn);

      expect(result.shortfallPercent).toBe(0.5);
      expect(result.traderEffectivePercent).toBe(6.5);
    });

    it('allows a shortfall that consumes the whole trader rate', () => {
      const result = computeDeal({
        kind: TransactionKind.PayOut,
        amountFiat: 10000,
        rate: 100,
        merchantPercent: 10,
        traderPercent: 2,
        platformMinPercent: 1,
        leads: [{ leadUserId: LEAD_A, percent: 9 }],
      });

      expect(result.shortfallPercent).toBe(2);
      expect(result.traderEffectivePercent).toBe(0);
    });

    it.each(DEAL_KINDS)(
      'refuses a %s whose shortfall is greater than the trader rate',
      (kind) => {
        expect(() =>
          computeDeal({
            kind,
            amountFiat: 10000,
            rate: 100,
            merchantPercent: 10,
            traderPercent: 2,
            platformMinPercent: 1,
            leads: [{ leadUserId: LEAD_A, percent: 9.5 }],
          }),
        ).toThrow(PlatformMinimumUnreachableError);
      },
    );
  });
});
