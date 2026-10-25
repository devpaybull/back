import { TransactionMethod } from './transaction-method';

export interface MethodPercent {
  method: TransactionMethod;
  payInPercent: number;
  payOutPercent: number;
}
