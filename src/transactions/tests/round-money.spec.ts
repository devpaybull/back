import { roundMoney } from '../utils/round-money';

describe('roundMoney', () => {
  it('keeps values already within three decimals', () => {
    expect(roundMoney(264.333)).toBe(264.333);
    expect(roundMoney(0)).toBe(0);
  });

  it('rounds non-half fractions to the nearest three-decimal value', () => {
    expect(roundMoney(295.34413)).toBe(295.344);
    expect(roundMoney(272.206568)).toBe(272.207);
    expect(roundMoney(13.47558)).toBe(13.476);
  });

  describe("banker's rounding: a half goes to the even neighbour", () => {
    it('rounds down when the lower neighbour is even', () => {
      expect(roundMoney(0.0025)).toBe(0.002);
      expect(roundMoney(0.0005)).toBe(0);
    });

    it('rounds up when the lower neighbour is odd', () => {
      expect(roundMoney(0.0015)).toBe(0.002);
      expect(roundMoney(0.0035)).toBe(0.004);
    });

    it('applies the same rule to negative halves', () => {
      expect(roundMoney(-0.0015)).toBe(-0.002);
      expect(roundMoney(-0.0025)).toBe(-0.002);
    });
  });
});
