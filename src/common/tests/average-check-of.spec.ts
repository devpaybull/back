import { toFiat } from '../utils/to-fiat';
import { averageCheckOf } from '../utils/average-check-of';

describe('averageCheckOf', () => {
  it('is null with nothing paid', () => {
    expect(averageCheckOf(toFiat(0), 0)).toBeNull();
  });

  it('divides the paid amount by the paid count, two decimals half to even', () => {
    expect(averageCheckOf(toFiat('3000.00'), 2)).toBe('1500.00');
    expect(averageCheckOf(toFiat('100.00'), 3)).toBe('33.33');
    expect(averageCheckOf(toFiat('0.05'), 2)).toBe('0.02');
  });
});
