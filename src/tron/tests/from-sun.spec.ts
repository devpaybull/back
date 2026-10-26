import { fromSun } from '../utils/from-sun';

describe('fromSun', () => {
  it('reads minor units as six decimals', () => {
    expect(fromSun('12345678').toFixed(6)).toBe('12.345678');
  });

  it('accepts a number and a bigint', () => {
    expect(fromSun(1).toFixed(6)).toBe('0.000001');
    expect(fromSun(1_000_000n).toFixed(6)).toBe('1.000000');
  });

  it('keeps an amount beyond 2^53 exact', () => {
    expect(fromSun(999999999999999999n).toFixed(6)).toBe('999999999999.999999');
  });
});
