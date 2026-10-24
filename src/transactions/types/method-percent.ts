import { TransactionMethod } from './transaction-method.enum';

export interface MethodPercent {
  method: TransactionMethod;
  payInPercent: number;
  payOutPercent: number;
}
