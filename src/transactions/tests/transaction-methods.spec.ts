import { RateKind } from '../types/rate-kind.enum';
import { TransactionMethodDefinition } from '../types/transaction-method-definition';
import { findTransactionMethod } from '../utils/find-transaction-method';
import {
  TRANSACTION_METHOD_CODES,
  TRANSACTION_METHODS,
} from '../utils/transaction-methods';

describe('the transaction method registry', () => {
  it('gives every method a unique code', () => {
    const codes = TRANSACTION_METHODS.map((method) => method.code);

    expect(new Set(codes).size).toBe(codes.length);
  });

  it('names every currency by an upper-case three-letter isocode', () => {
    for (const method of TRANSACTION_METHODS) {
      expect(method.currency).toMatch(/^[A-Z]{3}$/);
    }
  });

  it('gives every method exactly one known rate kind', () => {
    for (const method of TRANSACTION_METHODS) {
      expect(Object.values(RateKind)).toContain(method.rateKind);
    }
  });

  it('keeps any platform minimum override a non-negative number', () => {
    const definitions: readonly TransactionMethodDefinition[] =
      TRANSACTION_METHODS;

    for (const method of definitions) {
      const override = method.platformMinPercent;

      if (override !== undefined) expect(override).toBeGreaterThanOrEqual(0);
    }
  });

  it('starts with the four existing methods, all RUB and priced by amount', () => {
    expect(
      TRANSACTION_METHODS.map(({ code, currency, rateKind }) => ({
        code,
        currency,
        rateKind,
      })),
    ).toEqual([
      { code: 'sbp', currency: 'RUB', rateKind: RateKind.ByAmount },
      { code: 'card', currency: 'RUB', rateKind: RateKind.ByAmount },
      { code: 'counterparty', currency: 'RUB', rateKind: RateKind.ByAmount },
      {
        code: 'mobile_commerce',
        currency: 'RUB',
        rateKind: RateKind.ByAmount,
      },
    ]);
  });

  it('lists the codes in declaration order', () => {
    expect(TRANSACTION_METHOD_CODES).toEqual(
      TRANSACTION_METHODS.map((method) => method.code),
    );
  });

  it('finds a method by its code', () => {
    expect(findTransactionMethod('card')).toEqual(
      expect.objectContaining({ code: 'card', currency: 'RUB' }),
    );
  });

  it('finds nothing for an unknown code', () => {
    expect(findTransactionMethod('qr')).toBeUndefined();
    expect(findTransactionMethod('')).toBeUndefined();
  });

  it('gives any platform-minimum override as a percent: zero or more, at most three decimals', () => {
    for (const method of TRANSACTION_METHODS as readonly TransactionMethodDefinition[]) {
      if (method.platformMinPercent === undefined) continue;

      expect(method.platformMinPercent).toBeGreaterThanOrEqual(0);
      expect(Math.round(method.platformMinPercent * 1000)).toBe(
        method.platformMinPercent * 1000,
      );
    }
  });
});
