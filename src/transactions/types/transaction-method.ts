import { TRANSACTION_METHODS } from '../utils/transaction-methods';

export type TransactionMethod = (typeof TRANSACTION_METHODS)[number]['code'];
