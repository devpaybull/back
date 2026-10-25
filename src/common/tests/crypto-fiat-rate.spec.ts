import { formatCrypto } from '../utils/format-crypto';
import { formatFiat } from '../utils/format-fiat';
import { formatRate } from '../utils/format-rate';
import { roundCrypto } from '../utils/round-crypto';
import { roundFiat } from '../utils/round-fiat';
import { roundRate } from '../utils/round-rate';
import { toCrypto } from '../utils/to-crypto';
import { toFiat } from '../utils/to-fiat';
import { toRate } from '../utils/to-rate';

describe('crypto, fiat and rate amounts', () => {
  it('render crypto with six decimals', () => {
    expect(formatCrypto(toCrypto('90000.5'))).toBe('90000.500000');
    expect(formatCrypto(toCrypto('0.0000025'))).toBe('0.000002');
  });

  it('render fiat with two decimals', () => {
    expect(formatFiat(toFiat('1000.5'))).toBe('1000.50');
    expect(formatFiat(toFiat('0.125'))).toBe('0.12');
  });

  it('render a rate with six decimals', () => {
    expect(formatRate(toRate('88.92'))).toBe('88.920000');
  });

  it('round each to its own scale, half to even', () => {
    expect(roundCrypto('1.0000005').toFixed()).toBe('1');
    expect(roundFiat('1.005').toFixed()).toBe('1');
    expect(roundFiat('1.015').toFixed()).toBe('1.02');
    expect(roundRate('89.80920049').toFixed()).toBe('89.8092');
  });

  it('never render a negative zero and keep the sign of a negative amount', () => {
    expect(formatCrypto(toCrypto('-0.0000001'))).toBe('0.000000');
    expect(formatFiat(toFiat('-0.001'))).toBe('0.00');
    expect(formatCrypto(toCrypto('-12.5'))).toBe('-12.500000');
  });

  it('pass null and undefined through as null', () => {
    expect(formatCrypto(null)).toBeNull();
    expect(formatFiat(undefined)).toBeNull();
    expect(formatRate(null)).toBeNull();
  });
});
