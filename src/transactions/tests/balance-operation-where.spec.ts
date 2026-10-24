import { And, In, LessThan, MoreThanOrEqual } from 'typeorm';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { BalanceKind } from '../types/balance-kind.enum';
import { BalanceOperationType } from '../types/balance-operation-type.enum';
import { balanceOperationWhere } from '../utils/balance-operation-where';

describe('balanceOperationWhere', () => {
  const userId = uuidOf(1);
  const from = new Date('2026-10-01T00:00:00Z');
  const to = new Date('2026-11-01T00:00:00Z');

  it('scopes to the wallet and nothing else without filters', () => {
    expect(balanceOperationWhere(4, { userId })).toEqual({ walletId: 4 });
  });

  it('includes the start of the period and excludes the end', () => {
    expect(balanceOperationWhere(4, { userId, from, to })).toEqual({
      walletId: 4,
      createdAt: And(MoreThanOrEqual(from), LessThan(to)),
    });
  });

  it('accepts an open-ended period on either side', () => {
    expect(balanceOperationWhere(4, { userId, from })).toEqual({
      walletId: 4,
      createdAt: MoreThanOrEqual(from),
    });
    expect(balanceOperationWhere(4, { userId, to })).toEqual({
      walletId: 4,
      createdAt: LessThan(to),
    });
  });

  it('filters by a list of types and by the balance kind', () => {
    expect(
      balanceOperationWhere(4, {
        userId,
        types: [
          BalanceOperationType.Transaction,
          BalanceOperationType.Internal,
        ],
        kind: BalanceKind.InsurancePayIn,
      }),
    ).toEqual({
      walletId: 4,
      type: In([
        BalanceOperationType.Transaction,
        BalanceOperationType.Internal,
      ]),
      balanceKind: BalanceKind.InsurancePayIn,
    });
  });

  it('treats an empty type list as no filter', () => {
    expect(balanceOperationWhere(4, { userId, types: [] })).toEqual({
      walletId: 4,
    });
  });
});
