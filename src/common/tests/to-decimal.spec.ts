import Decimal from 'decimal.js';
import { toDecimal } from '../utils/to-decimal';

describe('toDecimal', () => {
  it('builds a decimal from a string without passing through a float', () => {
    expect(toDecimal('100.123456').toFixed()).toBe('100.123456');
  });

  it('sums ten thousand millionths exactly', () => {
    let total = toDecimal(0);
    for (let index = 0; index < 10_000; index += 1) {
      total = total.plus('0.000001');
    }

    expect(total.eq('0.01')).toBe(true);
  });

  it('keeps forty significant digits through a division', () => {
    expect(toDecimal('1000000000000').div(3).toFixed(6)).toBe(
      '333333333333.333333',
    );
  });

  it('does not change the global Decimal configuration', () => {
    expect(Decimal.precision).toBe(20);
  });
});
