import Decimal from 'decimal.js';
import { toDecimal } from './to-decimal';

export function roundHalfEven(value: Decimal.Value, scale: number): Decimal {
  const rounded = toDecimal(value).toDecimalPlaces(
    scale,
    Decimal.ROUND_HALF_EVEN,
  );

  return rounded.isZero() ? toDecimal(0) : rounded;
}
