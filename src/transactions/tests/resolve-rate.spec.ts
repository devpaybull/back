import { toFiat } from '../../common/utils/to-fiat';
import { RateCandidate } from '../types/rate-candidate';
import { RateKind } from '../types/rate-kind.enum';
import { NoBaseRateError, resolveRate } from '../utils/resolve-rate';

const base: RateCandidate = {
  hasSubject: false,
  fromAmount: null,
  toAmount: null,
  bankId: null,
  payInPercent: 10,
  payOutPercent: 3,
};

const individualGeneral: RateCandidate = {
  hasSubject: true,
  fromAmount: null,
  toAmount: null,
  bankId: null,
  payInPercent: 8,
  payOutPercent: 2,
};

const individualRange: RateCandidate = {
  hasSubject: true,
  fromAmount: toFiat(1000),
  toAmount: toFiat(5000),
  bankId: null,
  payInPercent: 6,
  payOutPercent: 1,
};

describe('resolveRate', () => {
  it('uses the base rate when individual rates are disabled', () => {
    const percent = resolveRate({
      candidates: [base, individualGeneral, individualRange],
      amount: toFiat(2000),
      rateKind: RateKind.ByAmount,
      individualEnabled: false,
      direction: 'payIn',
    });
    expect(percent).toBe(10);
  });

  it('prefers a matching individual range when enabled', () => {
    const percent = resolveRate({
      candidates: [base, individualGeneral, individualRange],
      amount: toFiat(2000),
      rateKind: RateKind.ByAmount,
      individualEnabled: true,
      direction: 'payIn',
    });
    expect(percent).toBe(6);
  });

  it('falls back to the individual general rate when no range matches', () => {
    const percent = resolveRate({
      candidates: [base, individualGeneral, individualRange],
      amount: toFiat(9000),
      rateKind: RateKind.ByAmount,
      individualEnabled: true,
      direction: 'payIn',
    });
    expect(percent).toBe(8);
  });

  it('falls back to the base rate when the subject has neither range nor general', () => {
    const percent = resolveRate({
      candidates: [base, individualRange],
      amount: toFiat(9000),
      rateKind: RateKind.ByAmount,
      individualEnabled: true,
      direction: 'payIn',
    });
    expect(percent).toBe(10);
  });

  it('reads the pay-out column for the pay-out direction', () => {
    const percent = resolveRate({
      candidates: [base, individualRange],
      amount: toFiat(2000),
      rateKind: RateKind.ByAmount,
      individualEnabled: true,
      direction: 'payOut',
    });
    expect(percent).toBe(1);
  });

  it('treats range boundaries as inclusive', () => {
    expect(
      resolveRate({
        candidates: [base, individualRange],
        amount: toFiat(1000),
        rateKind: RateKind.ByAmount,
        individualEnabled: true,
        direction: 'payIn',
      }),
    ).toBe(6);
    expect(
      resolveRate({
        candidates: [base, individualRange],
        amount: toFiat(5000),
        rateKind: RateKind.ByAmount,
        individualEnabled: true,
        direction: 'payIn',
      }),
    ).toBe(6);
  });

  it('throws when no base rate is configured', () => {
    expect(() =>
      resolveRate({
        candidates: [individualGeneral],
        amount: toFiat(2000),
        rateKind: RateKind.ByAmount,
        individualEnabled: false,
        direction: 'payIn',
      }),
    ).toThrow(NoBaseRateError);
  });
  it('does not mistake an individual bank row for the general rate of a method priced by amount', () => {
    expect(
      resolveRate({
        candidates: [base, bankRow(7, 4, 1)],
        amount: toFiat(2000),
        rateKind: RateKind.ByAmount,
        individualEnabled: true,
        direction: 'payIn',
      }),
    ).toBe(10);
  });
});

const bankRow = (
  bankId: number,
  payInPercent: number,
  payOutPercent: number,
): RateCandidate => ({
  hasSubject: true,
  fromAmount: null,
  toAmount: null,
  bankId,
  payInPercent,
  payOutPercent,
});

describe('resolveRate for a method priced by bank', () => {
  const resolve = (
    candidates: RateCandidate[],
    bankId: number | null,
    individualEnabled = true,
    direction: 'payIn' | 'payOut' = 'payIn',
  ) =>
    resolveRate({
      candidates,
      amount: toFiat(2000),
      bankId,
      rateKind: RateKind.ByBank,
      individualEnabled,
      direction,
    });

  it('uses the individual row of the deal bank', () => {
    expect(resolve([base, individualGeneral, bankRow(1, 7, 4)], 1)).toBe(7);
  });

  it('reads the pay-out column of the bank row for the pay-out direction', () => {
    expect(
      resolve([base, individualGeneral, bankRow(1, 7, 4)], 1, true, 'payOut'),
    ).toBe(4);
  });

  it('picks the row of the deal bank among several', () => {
    expect(
      resolve([base, bankRow(1, 7, 4), bankRow(2, 5, 3), individualGeneral], 2),
    ).toBe(5);
  });

  it('falls back to the individual general rate when the deal bank has no row', () => {
    expect(resolve([base, individualGeneral, bankRow(1, 7, 4)], 3)).toBe(8);
  });

  it('falls back to the individual general rate when the deal names no bank', () => {
    expect(resolve([base, individualGeneral, bankRow(1, 7, 4)], null)).toBe(8);
  });

  it('falls back to the base general rate when the subject has neither the bank row nor a general rate', () => {
    expect(resolve([base, bankRow(1, 7, 4)], 3)).toBe(10);
  });

  it('ignores every individual row while individual rates are disabled', () => {
    expect(resolve([base, individualGeneral, bankRow(1, 7, 4)], 1, false)).toBe(
      10,
    );
  });

  it('ignores amount bands', () => {
    expect(resolve([base, individualRange], 1)).toBe(10);
  });

  it('throws when no base rate is configured', () => {
    expect(() => resolve([bankRow(1, 7, 4)], 2)).toThrow(NoBaseRateError);
  });
});
