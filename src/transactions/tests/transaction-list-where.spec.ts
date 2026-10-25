import { Between, In, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { toFiat } from '../../common/utils/to-fiat';
import { SortOrder } from '../../common/enums/sort-order.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { TransactionKind } from '../types/transaction-kind.enum';
import { TransactionListQuery } from '../types/transaction-list-query';
import { TransactionSortField } from '../types/transaction-sort-field.enum';
import { TransactionStatus } from '../types/transaction-status.enum';
import { transactionListWhere } from '../utils/transaction-list-where';

const query = (
  overrides: Partial<TransactionListQuery> = {},
): TransactionListQuery => ({
  page: 1,
  limit: 20,
  sortBy: TransactionSortField.CreatedAt,
  sortOrder: SortOrder.Desc,
  ...overrides,
});

const FROM = new Date('2026-10-01T00:00:00.000Z');
const TO = new Date('2026-10-31T23:59:59.999Z');

describe('transactionListWhere', () => {
  it('asks for everything when nothing was filtered', () => {
    expect(transactionListWhere(query())).toEqual({});
  });

  it('keeps the filters that were there before the deals tab', () => {
    expect(
      transactionListWhere(
        query({
          kind: TransactionKind.PayIn,
          status: TransactionStatus.Active,
          method: 'sbp',
          traderUserId: uuidOf(1),
          merchantId: uuidOf(2),
        }),
      ),
    ).toEqual({
      kind: TransactionKind.PayIn,
      status: TransactionStatus.Active,
      method: 'sbp',
      traderUserId: uuidOf(1),
      merchantId: uuidOf(2),
    });
  });

  it('bounds the creation moment on both sides, inclusively', () => {
    expect(
      transactionListWhere(query({ createdFrom: FROM, createdTo: TO })),
    ).toEqual({ createdAt: Between(FROM, TO) });
  });

  it('bounds the creation moment from below only', () => {
    expect(transactionListWhere(query({ createdFrom: FROM }))).toEqual({
      createdAt: MoreThanOrEqual(FROM),
    });
  });

  it('bounds the creation moment from above only', () => {
    expect(transactionListWhere(query({ createdTo: TO }))).toEqual({
      createdAt: LessThanOrEqual(TO),
    });
  });

  it('bounds the fiat amount on both sides, inclusively', () => {
    expect(
      transactionListWhere(
        query({ amountFrom: toFiat(1000), amountTo: toFiat(5000) }),
      ),
    ).toEqual({ amountFiat: Between(toFiat(1000), toFiat(5000)) });
  });

  it('treats a zero amount bound as a real bound, not as absent', () => {
    expect(transactionListWhere(query({ amountFrom: toFiat(0) }))).toEqual({
      amountFiat: MoreThanOrEqual(toFiat(0)),
    });
    expect(transactionListWhere(query({ amountTo: toFiat(0) }))).toEqual({
      amountFiat: LessThanOrEqual(toFiat(0)),
    });
  });

  it('narrows to the requisites it was handed, in SQL', () => {
    expect(
      transactionListWhere(query({ bankDetailsIds: [uuidOf(10), uuidOf(11)] })),
    ).toEqual({ bankDetailsId: In([uuidOf(10), uuidOf(11)]) });
  });

  it('combines every filter into one condition', () => {
    expect(
      transactionListWhere(
        query({
          kind: TransactionKind.PayOut,
          merchantId: uuidOf(2),
          createdFrom: FROM,
          amountTo: toFiat(300),
          bankDetailsIds: [uuidOf(10)],
        }),
      ),
    ).toEqual({
      kind: TransactionKind.PayOut,
      merchantId: uuidOf(2),
      createdAt: MoreThanOrEqual(FROM),
      amountFiat: LessThanOrEqual(toFiat(300)),
      bankDetailsId: In([uuidOf(10)]),
    });
  });
});
