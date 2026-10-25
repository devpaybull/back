import { toFiat } from '../../common/utils/to-fiat';
import { AmountLimitKey } from '../types/amount-limit-key';
import { BankDetailsLimits } from '../types/bank-details-limits';

const AMOUNT_LIMIT_KEYS: AmountLimitKey[] = [
  'minAmount',
  'maxAmount',
  'dailyAmountLimit',
  'monthlyAmountLimit',
];

export function withFiatLimits<
  T extends Partial<Record<AmountLimitKey, string | null>>,
>(
  dto: T,
): Omit<T, AmountLimitKey> & Partial<Pick<BankDetailsLimits, AmountLimitKey>> {
  const converted: Record<string, unknown> = { ...dto };

  for (const key of AMOUNT_LIMIT_KEYS) {
    const value = dto[key];
    if (typeof value === 'string') converted[key] = toFiat(value);
  }

  return converted as Omit<T, AmountLimitKey> &
    Partial<Pick<BankDetailsLimits, AmountLimitKey>>;
}
