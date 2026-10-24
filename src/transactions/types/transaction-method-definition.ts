import { RateKind } from './rate-kind.enum';

export interface TransactionMethodDefinition {
  code: string;
  currency: string;
  rateKind: RateKind;
  platformMinPercent?: number;
}
