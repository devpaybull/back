import { DECIMAL_AMOUNT_MAX } from './decimal-amount-max';
import { toDecimal } from './to-decimal';

const MAX_LEADING_DIGITS = 12;

export function isDecimalAmount(
  value: unknown,
  scale: number,
  positive: boolean,
): boolean {
  const pattern = new RegExp(
    `^(0|[1-9]\\d{0,${MAX_LEADING_DIGITS}})(\\.\\d{1,${scale}})?$`,
  );

  if (typeof value !== 'string' || !pattern.test(value)) return false;

  const amount = toDecimal(value);

  return amount.lte(DECIMAL_AMOUNT_MAX) && (!positive || amount.gt(0));
}
