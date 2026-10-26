import { isSuccessfulTransaction } from '../utils/is-successful-transaction';

describe('isSuccessfulTransaction', () => {
  it('accepts a SUCCESS receipt', () => {
    expect(
      isSuccessfulTransaction({ id: 'x', receipt: { result: 'SUCCESS' } }),
    ).toBe(true);
  });

  it('accepts a transaction without a contract receipt result (a TRX transfer)', () => {
    expect(isSuccessfulTransaction({ id: 'x' })).toBe(true);
    expect(isSuccessfulTransaction({ id: 'x', receipt: {} })).toBe(true);
  });

  it.each(['REVERT', 'OUT_OF_ENERGY', 'OUT_OF_TIME'])(
    'refuses %s',
    (result) => {
      expect(isSuccessfulTransaction({ id: 'x', receipt: { result } })).toBe(
        false,
      );
    },
  );

  it('refuses a FAILED result even with a SUCCESS receipt', () => {
    expect(
      isSuccessfulTransaction({
        id: 'x',
        result: 'FAILED',
        receipt: { result: 'SUCCESS' },
      }),
    ).toBe(false);
  });
});
