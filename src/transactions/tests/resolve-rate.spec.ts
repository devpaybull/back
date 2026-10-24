import { RateCandidate } from '../types/rate-candidate';
import { NoBaseRateError, resolveRate } from '../utils/resolve-rate';

const base: RateCandidate = {
  hasSubject: false,
  fromAmount: null,
  toAmount: null,
  payInPercent: 10,
  payOutPercent: 3,
};

const individualGeneral: RateCandidate = {
  hasSubject: true,
  fromAmount: null,
  toAmount: null,
  payInPercent: 8,
  payOutPercent: 2,
};

const individualRange: RateCandidate = {
  hasSubject: true,
  fromAmount: 1000,
  toAmount: 5000,
  payInPercent: 6,
  payOutPercent: 1,
};

describe('resolveRate', () => {
  it('uses the base rate when individual rates are disabled', () => {
    const percent = resolveRate({
      candidates: [base, individualGeneral, individualRange],
      amount: 2000,
      individualEnabled: false,
      direction: 'payIn',
    });
    expect(percent).toBe(10);
  });

  it('prefers a matching individual range when enabled', () => {
    const percent = resolveRate({
      candidates: [base, individualGeneral, individualRange],
      amount: 2000,
      individualEnabled: true,
      direction: 'payIn',
    });
    expect(percent).toBe(6);
  });

  it('falls back to the individual general rate when no range matches', () => {
    const percent = resolveRate({
      candidates: [base, individualGeneral, individualRange],
      amount: 9000,
      individualEnabled: true,
      direction: 'payIn',
    });
    expect(percent).toBe(8);
  });

  it('falls back to the base rate when the subject has neither range nor general', () => {
    const percent = resolveRate({
      candidates: [base, individualRange],
      amount: 9000,
      individualEnabled: true,
      direction: 'payIn',
    });
    expect(percent).toBe(10);
  });

  it('reads the pay-out column for the pay-out direction', () => {
    const percent = resolveRate({
      candidates: [base, individualRange],
      amount: 2000,
      individualEnabled: true,
      direction: 'payOut',
    });
    expect(percent).toBe(1);
  });

  it('treats range boundaries as inclusive', () => {
    expect(
      resolveRate({
        candidates: [base, individualRange],
        amount: 1000,
        individualEnabled: true,
        direction: 'payIn',
      }),
    ).toBe(6);
    expect(
      resolveRate({
        candidates: [base, individualRange],
        amount: 5000,
        individualEnabled: true,
        direction: 'payIn',
      }),
    ).toBe(6);
  });

  it('throws when no base rate is configured', () => {
    expect(() =>
      resolveRate({
        candidates: [individualGeneral],
        amount: 2000,
        individualEnabled: false,
        direction: 'payIn',
      }),
    ).toThrow(NoBaseRateError);
  });
});
