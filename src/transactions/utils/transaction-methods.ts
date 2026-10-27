import { RateKind } from '../types/rate-kind.enum';
import { TransactionKind } from '../types/transaction-kind.enum';
import { TransactionMethodDefinition } from '../types/transaction-method-definition';

const BOTH_DIRECTIONS = [
  TransactionKind.PayIn,
  TransactionKind.PayOut,
] as const;

const PAY_IN_ONLY = [TransactionKind.PayIn] as const;

export const TRANSACTION_METHODS = [
  {
    code: 'sbp',
    currency: 'RUB',
    rateKind: RateKind.ByAmount,
    directions: BOTH_DIRECTIONS,
  },
  {
    code: 'card',
    currency: 'RUB',
    rateKind: RateKind.ByAmount,
    directions: BOTH_DIRECTIONS,
  },
  {
    code: 'counterparty',
    currency: 'RUB',
    rateKind: RateKind.ByAmount,
    directions: PAY_IN_ONLY,
  },
  {
    code: 'mobile_commerce',
    currency: 'RUB',
    rateKind: RateKind.ByAmount,
    directions: PAY_IN_ONLY,
  },
] as const satisfies readonly TransactionMethodDefinition[];

export const TRANSACTION_METHOD_CODES: readonly string[] =
  TRANSACTION_METHODS.map((method) => method.code);
