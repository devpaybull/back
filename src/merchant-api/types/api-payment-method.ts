import { TransactionMethod } from '../../transactions/types/transaction-method';

export interface ApiPaymentMethod {
  code: TransactionMethod;
  currency: string;
}
