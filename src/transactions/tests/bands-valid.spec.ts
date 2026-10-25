import { toFiat } from '../../common/utils/to-fiat';
import { bandsAreValid } from '../utils/bands-valid';

describe('bandsAreValid', () => {
  it('accepts an empty set', () => {
    expect(bandsAreValid([])).toBe(true);
  });

  it('accepts disjoint ascending bands', () => {
    expect(
      bandsAreValid([
        { fromAmount: toFiat(1000), toAmount: toFiat(5000) },
        { fromAmount: toFiat(5001), toAmount: toFiat(9000) },
      ]),
    ).toBe(true);
  });

  it('rejects a band whose lower bound exceeds its upper bound', () => {
    expect(
      bandsAreValid([{ fromAmount: toFiat(500), toAmount: toFiat(100) }]),
    ).toBe(false);
  });

  it('rejects overlapping bands', () => {
    expect(
      bandsAreValid([
        { fromAmount: toFiat(1000), toAmount: toFiat(5000) },
        { fromAmount: toFiat(4000), toAmount: toFiat(9000) },
      ]),
    ).toBe(false);
  });

  it('treats touching endpoints as overlap because ranges are inclusive', () => {
    expect(
      bandsAreValid([
        { fromAmount: toFiat(1000), toAmount: toFiat(5000) },
        { fromAmount: toFiat(5000), toAmount: toFiat(9000) },
      ]),
    ).toBe(false);
  });

  it('tells bands apart on the sixth decimal', () => {
    expect(
      bandsAreValid([
        { fromAmount: toFiat('1000'), toAmount: toFiat('5000') },
        { fromAmount: toFiat('5000.000001'), toAmount: toFiat('9000') },
      ]),
    ).toBe(true);
  });

  it('does not depend on input order', () => {
    expect(
      bandsAreValid([
        { fromAmount: toFiat(5001), toAmount: toFiat(9000) },
        { fromAmount: toFiat(1000), toAmount: toFiat(5000) },
      ]),
    ).toBe(true);
  });
});
