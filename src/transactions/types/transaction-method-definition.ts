import { RateKind } from './rate-kind.enum';
import { TransactionKind } from './transaction-kind.enum';

export interface TransactionMethodDefinition {
  code: string;
  currency: string;
  rateKind: RateKind;
  directions: readonly TransactionKind[];
  platformMinPercent?: number;
}
