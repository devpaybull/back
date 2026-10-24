import { bandsAreValid } from '../utils/bands-valid';

describe('bandsAreValid', () => {
  it('accepts an empty set', () => {
    expect(bandsAreValid([])).toBe(true);
  });

  it('accepts disjoint ascending bands', () => {
    expect(
      bandsAreValid([
        { fromAmount: 1000, toAmount: 5000 },
        { fromAmount: 5001, toAmount: 9000 },
      ]),
    ).toBe(true);
  });

  it('rejects a band whose lower bound exceeds its upper bound', () => {
    expect(bandsAreValid([{ fromAmount: 500, toAmount: 100 }])).toBe(false);
  });

  it('rejects overlapping bands', () => {
    expect(
      bandsAreValid([
        { fromAmount: 1000, toAmount: 5000 },
        { fromAmount: 4000, toAmount: 9000 },
      ]),
    ).toBe(false);
  });

  it('treats touching endpoints as overlap because ranges are inclusive', () => {
    expect(
      bandsAreValid([
        { fromAmount: 1000, toAmount: 5000 },
        { fromAmount: 5000, toAmount: 9000 },
      ]),
    ).toBe(false);
  });

  it('does not depend on input order', () => {
    expect(
      bandsAreValid([
        { fromAmount: 5001, toAmount: 9000 },
        { fromAmount: 1000, toAmount: 5000 },
      ]),
    ).toBe(true);
  });
});
