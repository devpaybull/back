import { ColumnNumericTransformer } from '../utils/column-numeric-transformer';

describe('ColumnNumericTransformer', () => {
  const transformer = new ColumnNumericTransformer();

  describe('from (database → application)', () => {
    it('parses a numeric string into a number', () => {
      expect(transformer.from('295.344')).toBe(295.344);
    });

    it('keeps three-decimal values exact', () => {
      expect(transformer.from('264.333')).toBe(264.333);
      expect(transformer.from('0.001')).toBe(0.001);
    });

    it('reads a zero balance as the number 0, not null', () => {
      expect(transformer.from('0.000')).toBe(0);
    });

    it('maps null to null', () => {
      expect(transformer.from(null)).toBeNull();
    });
  });

  describe('to (application → database)', () => {
    it('passes a number through unchanged', () => {
      expect(transformer.to(272.207)).toBe(272.207);
    });

    it('passes zero through unchanged', () => {
      expect(transformer.to(0)).toBe(0);
    });

    it('leaves null and undefined untouched so column defaults apply', () => {
      expect(transformer.to(null)).toBeNull();
      expect(transformer.to(undefined)).toBeUndefined();
    });
  });
});
