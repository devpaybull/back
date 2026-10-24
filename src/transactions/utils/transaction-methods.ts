import { RateKind } from '../types/rate-kind.enum';
import { TransactionMethodDefinition } from '../types/transaction-method-definition';

export const TRANSACTION_METHODS = [
  { code: 'sbp', currency: 'RUB', rateKind: RateKind.ByAmount },
  { code: 'card', currency: 'RUB', rateKind: RateKind.ByAmount },
  { code: 'counterparty', currency: 'RUB', rateKind: RateKind.ByAmount },
  { code: 'mobile_commerce', currency: 'RUB', rateKind: RateKind.ByAmount },
] as const satisfies readonly TransactionMethodDefinition[];

export const TRANSACTION_METHOD_CODES: readonly string[] =
  TRANSACTION_METHODS.map((method) => method.code);
