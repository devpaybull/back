import { roundHalfEven } from '../utils/round-half-even';

const rounded = (value: string, scale: number): string =>
  roundHalfEven(value, scale).toFixed();

describe('roundHalfEven', () => {
  it('keeps values already within the scale exactly', () => {
    expect(rounded('100.123456', 6)).toBe('100.123456');
    expect(rounded('1000.5', 2)).toBe('1000.5');
  });

  it('rounds non-half fractions to the nearest value of the scale', () => {
    expect(rounded('295.3441349', 6)).toBe('295.344135');
    expect(rounded('1000.126', 2)).toBe('1000.13');
  });

  it('sends a half to the even neighbour, negatives included', () => {
    expect(rounded('0.0000025', 6)).toBe('0.000002');
    expect(rounded('0.0000035', 6)).toBe('0.000004');
    expect(rounded('0.125', 2)).toBe('0.12');
    expect(rounded('0.135', 2)).toBe('0.14');
    expect(rounded('-0.125', 2)).toBe('-0.12');
  });

  it('never returns a negative zero', () => {
    expect(roundHalfEven('-0.0000001', 6).isNegative()).toBe(false);
    expect(roundHalfEven('-0.001', 2).isNegative()).toBe(false);
  });
});
