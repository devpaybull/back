import { formatCrypto } from '../../common/utils/format-crypto';
import { toRate } from '../../common/utils/to-rate';
import { toFiat } from '../../common/utils/to-fiat';
import { DealComputation } from '../types/deal-computation';
import { TransactionKind } from '../types/transaction-kind.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import {
  computeDeal,
  PlatformMinimumUnreachableError,
} from '../utils/compute-deal';

const LEAD_A = uuidOf(21);
const LEAD_B = uuidOf(22);
const DEAL_KINDS = [TransactionKind.PayIn, TransactionKind.PayOut] as const;

const sharesOf = (result: DealComputation) =>
  result.leadShares.map((lead) => ({
    leadUserId: lead.leadUserId,
    percent: lead.percent,
    amount: formatCrypto(lead.amount),
  }));

describe('computeDeal', () => {
  describe('pay-in (plan section 5, example 1)', () => {
    const result = computeDeal({
      kind: TransactionKind.PayIn,
      amountFiat: toFiat('26262'),
      rate: toRate('88.92'),
      merchantPercent: 10.5,
      traderPercent: 8.5,
      platformMinPercent: 0,
    });

    it('crypto = amount / rate', () => {
      expect(formatCrypto(result.amountCrypto)).toBe('295.344130');
    });

    it('merchant commission = crypto × merchantPercent', () => {
      expect(formatCrypto(result.merchantCommission)).toBe('31.011134');
    });

    it('merchant receives crypto − merchantCommission', () => {
      expect(formatCrypto(result.merchantAmount)).toBe('264.332996');
    });

    it('trader is charged amount / (rate × (1 + traderPercent))', () => {
      expect(formatCrypto(result.traderAmount)).toBe('272.206571');
    });

    it('trader earns |crypto − traderAmount|', () => {
      expect(formatCrypto(result.traderCommission)).toBe('23.137559');
    });

    it('leaves the platform margin as merchantAmount vs traderAmount', () => {
      expect(
        formatCrypto(result.traderAmount.minus(result.merchantAmount)),
      ).toBe('7.873575');
    });
  });

  describe('pay-out (plan section 5, example 2)', () => {
    const result = computeDeal({
      kind: TransactionKind.PayOut,
      amountFiat: toFiat('40000'),
      rate: toRate('89.05'),
      merchantPercent: 3,
      traderPercent: 1.5,
      platformMinPercent: 0,
    });

    it('crypto = amount / rate', () => {
      expect(formatCrypto(result.amountCrypto)).toBe('449.185851');
    });

    it('merchant commission = crypto × merchantPercent', () => {
      expect(formatCrypto(result.merchantCommission)).toBe('13.475576');
    });

    it('trader earns crypto × traderPercent', () => {
      expect(formatCrypto(result.traderCommission)).toBe('6.737788');
    });

    it('trader is credited crypto + traderCommission', () => {
      expect(formatCrypto(result.traderAmount)).toBe('455.923639');
    });

    it('merchant is charged crypto + merchantCommission (round-each convention)', () => {
      expect(formatCrypto(result.merchantAmount)).toBe('462.661427');
    });
  });

  describe('lead commission', () => {
    it('is null when no lead percent is supplied', () => {
      const result = computeDeal({
        kind: TransactionKind.PayIn,
        amountFiat: toFiat('26262'),
        rate: toRate('88.92'),
        merchantPercent: 10.5,
        traderPercent: 8.5,
        platformMinPercent: 0,
      });
      expect(result.leadCommission).toBeNull();
    });

    it('is crypto × leadPercent when supplied', () => {
      const result = computeDeal({
        kind: TransactionKind.PayIn,
        amountFiat: toFiat('26262'),
        rate: toRate('88.92'),
        merchantPercent: 10.5,
        traderPercent: 8.5,
        platformMinPercent: 0,
        leads: [{ leadUserId: LEAD_A, percent: 2 }],
      });
      expect(formatCrypto(result.leadCommission)).toBe('5.906883');
      expect(sharesOf(result)).toEqual([
        { leadUserId: LEAD_A, percent: 2, amount: '5.906883' },
      ]);
    });
  });

  it('is exact with six-decimal fiat amounts', () => {
    const result = computeDeal({
      kind: TransactionKind.PayOut,
      amountFiat: toFiat('100.000001'),
      rate: toRate('1'),
      merchantPercent: 0,
      traderPercent: 0,
      platformMinPercent: 0,
    });

    expect(formatCrypto(result.amountCrypto)).toBe('100.000001');
  });

  describe('the platform minimum and the lead shares (spec 08)', () => {
    const ownerExample = (
      kind: TransactionKind.PayIn | TransactionKind.PayOut,
    ) =>
      computeDeal({
        kind,
        amountFiat: toFiat('10000'),
        rate: toRate('100'),
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
          expect(sharesOf(result)).toEqual([
            { leadUserId: LEAD_A, percent: 2.5, amount: '2.500000' },
          ]);
          expect(formatCrypto(result.leadCommission)).toBe('2.500000');
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

      expect(formatCrypto(result.traderAmount)).toBe('93.896714');
      expect(formatCrypto(result.traderCommission)).toBe('6.103286');
      expect(formatCrypto(result.merchantAmount)).toBe('90.000000');
    });

    it('credits the pay-out trader crypto + 6.5%', () => {
      const result = ownerExample(TransactionKind.PayOut);

      expect(formatCrypto(result.traderCommission)).toBe('6.500000');
      expect(formatCrypto(result.traderAmount)).toBe('106.500000');
      expect(formatCrypto(result.merchantAmount)).toBe('110.000000');
    });

    it('takes nothing off the trader when the margin covers the leads and the minimum', () => {
      const result = computeDeal({
        kind: TransactionKind.PayIn,
        amountFiat: toFiat('10000'),
        rate: toRate('100'),
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
        amountFiat: toFiat('10000'),
        rate: toRate('100'),
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
      expect(sharesOf(result)).toEqual([
        { leadUserId: LEAD_A, percent: 1.5, amount: '1.500000' },
        { leadUserId: LEAD_B, percent: 1, amount: '1.000000' },
      ]);
      expect(formatCrypto(result.leadCommission)).toBe('2.500000');
    });

    it.each(DEAL_KINDS)(
      'takes no shortfall and never refuses a %s with no leads, even under the minimum',
      (kind) => {
        const result = computeDeal({
          kind,
          amountFiat: toFiat('10000'),
          rate: toRate('100'),
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
          amountFiat: toFiat('10000'),
          rate: toRate('100'),
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
        amountFiat: toFiat('10000'),
        rate: toRate('100'),
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
            amountFiat: toFiat('10000'),
            rate: toRate('100'),
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
