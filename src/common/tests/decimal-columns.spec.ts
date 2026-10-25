import Decimal from 'decimal.js';
import { cryptoColumn } from '../utils/crypto-column';
import { DecimalColumnTransformer } from '../utils/decimal-column-transformer';
import { fiatColumn } from '../utils/fiat-column';
import { rateColumn } from '../utils/rate-column';
import { toDecimal } from '../utils/to-decimal';

describe('decimal columns', () => {
  it.each([
    ['crypto', cryptoColumn(), 6],
    ['fiat', fiatColumn(), 2],
    ['rate', rateColumn(), 6],
  ])(
    'the %s column is numeric(20, %#) with its own scale',
    (_name, options, scale) => {
      expect(options.type).toBe('numeric');
      expect(options.precision).toBe(20);
      expect(options.scale).toBe(scale);
      expect(options.transformer).toBeInstanceOf(DecimalColumnTransformer);
      expect((options.transformer as DecimalColumnTransformer).scale).toBe(
        scale,
      );
    },
  );

  it('lets the caller add options such as nullable', () => {
    expect(fiatColumn({ nullable: true }).nullable).toBe(true);
  });
});

describe('DecimalColumnTransformer', () => {
  const fiat = new DecimalColumnTransformer(2);

  it('reads the numeric string into an exact decimal, zero included', () => {
    const value = fiat.from('1000.50');

    expect(Decimal.isDecimal(value)).toBe(true);
    expect(value?.toFixed()).toBe('1000.5');
    expect(fiat.from('0.00')?.isZero()).toBe(true);
  });

  it('maps null and undefined to null', () => {
    expect(fiat.from(null)).toBeNull();
    expect(fiat.from(undefined)).toBeNull();
  });

  it('writes a decimal as a string of its own scale, rounded half to even', () => {
    expect(fiat.to(toDecimal('1000.125'))).toBe('1000.12');
    expect(new DecimalColumnTransformer(6).to(toDecimal('272.2'))).toBe(
      '272.200000',
    );
  });

  it('passes null, undefined and anything else through untouched', () => {
    const operator = { type: 'moreThan', value: 0 };

    expect(fiat.to(null)).toBeNull();
    expect(fiat.to(undefined)).toBeUndefined();
    expect(fiat.to(operator)).toBe(operator);
  });
});
