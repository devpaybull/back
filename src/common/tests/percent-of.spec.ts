import { percentOf } from '../utils/percent-of';

describe('percentOf', () => {
  it('is null with nothing to divide by', () => {
    expect(percentOf(0, 0)).toBeNull();
  });

  it('is the percent of the part in the whole, two decimals', () => {
    expect(percentOf(4, 8)).toBe(50);
    expect(percentOf(1, 3)).toBe(33.33);
    expect(percentOf(2, 3)).toBe(66.67);
  });

  it('rounds a half to even, in decimals, never through a float', () => {
    expect(percentOf(1, 32)).toBe(3.12);
    expect(percentOf(3, 32)).toBe(9.38);
  });

  it('is 100 when everything was paid', () => {
    expect(percentOf(7, 7)).toBe(100);
  });
});
