import Decimal from 'decimal.js';
import { formatFiat } from './format-fiat';
import { roundFiat } from './round-fiat';
import { toDecimal } from './to-decimal';

export function averageCheckOf(
  paidAmount: Decimal,
  paidCount: number,
): string | null {
  if (paidCount === 0) return null;

  return formatFiat(roundFiat(toDecimal(paidAmount).div(paidCount)));
}
