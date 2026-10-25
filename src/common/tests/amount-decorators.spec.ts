import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { IsCryptoAmount } from '../decorators/is-crypto-amount.decorator';
import { IsFiatAmount } from '../decorators/is-fiat-amount.decorator';

class CryptoAmount {
  @IsCryptoAmount()
  amount: unknown;
}

class PositiveCryptoAmount {
  @IsCryptoAmount({ positive: true })
  amount: unknown;
}

class FiatAmount {
  @IsFiatAmount()
  amount: unknown;
}

const isValid = (target: new () => object, amount: unknown): boolean =>
  validateSync(plainToInstance(target, { amount })).length === 0;

describe('IsCryptoAmount', () => {
  it('accepts a decimal string with up to six decimals', () => {
    expect(isValid(CryptoAmount, '100.123456')).toBe(true);
    expect(isValid(CryptoAmount, '0')).toBe(true);
  });

  it('refuses a seventh decimal instead of rounding it away', () => {
    expect(isValid(CryptoAmount, '1.1234567')).toBe(false);
  });

  it('refuses zero when the amount must be positive', () => {
    expect(isValid(PositiveCryptoAmount, '0')).toBe(false);
    expect(isValid(PositiveCryptoAmount, '0.000001')).toBe(true);
  });
});

describe('IsFiatAmount', () => {
  it('accepts kopecks: up to two decimals', () => {
    expect(isValid(FiatAmount, '1000.50')).toBe(true);
    expect(isValid(FiatAmount, '1000')).toBe(true);
  });

  it('refuses a third decimal', () => {
    expect(isValid(FiatAmount, '1000.505')).toBe(false);
  });
});

describe.each([
  ['IsCryptoAmount', CryptoAmount],
  ['IsFiatAmount', FiatAmount],
])('%s, like every amount', (_name, target) => {
  it('refuses a JSON number: amounts travel as strings', () => {
    expect(isValid(target, 100)).toBe(false);
  });

  it('refuses signs, exponents, spaces and empty strings', () => {
    for (const amount of ['-1', '+1', '1e3', ' 1', '1.', '.5', '']) {
      expect(isValid(target, amount)).toBe(false);
    }
  });

  it('refuses leading zeros: an amount has one way to be written', () => {
    expect(isValid(target, '0500')).toBe(false);
    expect(isValid(target, '00')).toBe(false);
    expect(isValid(target, '0.5')).toBe(true);
  });

  it('caps the amount at one trillion', () => {
    expect(isValid(target, '1000000000000')).toBe(true);
    expect(isValid(target, '1000000000000.01')).toBe(false);
  });
});
