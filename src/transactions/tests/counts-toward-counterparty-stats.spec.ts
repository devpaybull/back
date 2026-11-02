import { TransactionKind } from '../types/transaction-kind.enum';
import { countsTowardCounterpartyStats } from '../utils/counts-toward-counterparty-stats';

describe('countsTowardCounterpartyStats', () => {
  it('counts a pay-in of a counterparty through a ruble method', () => {
    expect(
      countsTowardCounterpartyStats({
        kind: TransactionKind.PayIn,
        counterpartyId: 3,
        method: 'sbp',
      }),
    ).toBe(true);
  });

  it('does not count a pay-out', () => {
    expect(
      countsTowardCounterpartyStats({
        kind: TransactionKind.PayOut,
        counterpartyId: 3,
        method: 'sbp',
      }),
    ).toBe(false);
  });

  it.each([null, undefined])(
    'does not count a deal whose counterparty is %s',
    (counterpartyId) => {
      expect(
        countsTowardCounterpartyStats({
          kind: TransactionKind.PayIn,
          counterpartyId,
          method: 'sbp',
        }),
      ).toBe(false);
    },
  );

  it('does not count a method outside the registry', () => {
    expect(
      countsTowardCounterpartyStats({
        kind: TransactionKind.PayIn,
        counterpartyId: 3,
        method: 'qr' as never,
      }),
    ).toBe(false);
  });
});
