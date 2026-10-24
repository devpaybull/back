import { TransactionMethodDefinition } from '../types/transaction-method-definition';
import { TRANSACTION_METHODS } from './transaction-methods';

export function findTransactionMethod(
  code: string,
): TransactionMethodDefinition | undefined {
  return (TRANSACTION_METHODS as readonly TransactionMethodDefinition[]).find(
    (method) => method.code === code,
  );
}
