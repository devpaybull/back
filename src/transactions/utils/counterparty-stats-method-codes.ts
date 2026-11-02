import { COUNTERPARTY_STATS_CURRENCY } from '../../counterparties/utils/counterparty-stats-currency';
import { TRANSACTION_METHODS } from './transaction-methods';

export const COUNTERPARTY_STATS_METHOD_CODES: readonly string[] =
  TRANSACTION_METHODS.filter(
    (method) => method.currency === COUNTERPARTY_STATS_CURRENCY,
  ).map((method) => method.code);
