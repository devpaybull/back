import { Transaction } from '../entities/transaction.entity';
import { TransactionKind } from '../types/transaction-kind.enum';
import { COUNTERPARTY_STATS_METHOD_CODES } from './counterparty-stats-method-codes';

export function countsTowardCounterpartyStats(
  transaction: Pick<Transaction, 'kind' | 'counterpartyId' | 'method'>,
): boolean {
  return (
    transaction.kind === TransactionKind.PayIn &&
    transaction.counterpartyId !== null &&
    transaction.counterpartyId !== undefined &&
    COUNTERPARTY_STATS_METHOD_CODES.includes(transaction.method)
  );
}
