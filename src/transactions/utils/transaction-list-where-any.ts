import { FindOptionsWhere, ILike, In } from 'typeorm';
import { escapeLikePattern } from '../../common/utils/escape-like-pattern';
import { Transaction } from '../entities/transaction.entity';
import { TransactionListQuery } from '../types/transaction-list-query';
import { TransactionTextMatch } from '../types/transaction-text-match';
import { transactionListWhere } from './transaction-list-where';
import { uuidTextContains } from './uuid-text-contains';

type Where = FindOptionsWhere<Transaction>;

const containing = (text: string) => ILike(`%${escapeLikePattern(text)}%`);

export function transactionListWhereAny(
  query: TransactionListQuery & TransactionTextMatch,
): Where[] {
  const groups: Where[][] = [];

  if (query.search !== undefined) {
    groups.push([
      { id: uuidTextContains(query.search) },
      { merchantTransactionId: containing(query.search) },
    ]);
  }

  if (query.requisite !== undefined) {
    const text = containing(query.requisite.text);
    const atBank = query.bankDetailsIds;
    const requisiteIds = atBank
      ? query.requisite.bankDetailsIds.filter((id) => atBank.includes(id))
      : query.requisite.bankDetailsIds;

    groups.push([
      ...(requisiteIds.length ? [{ bankDetailsId: In(requisiteIds) }] : []),
      { payoutCardNumber: text },
      { payoutPhone: text },
      { payoutOwnerName: text },
    ]);
  }

  return groups.reduce<Where[]>(
    (combined, group) =>
      combined.flatMap((where) =>
        group.map((alternative) => ({ ...where, ...alternative })),
      ),
    [transactionListWhere(query)],
  );
}
