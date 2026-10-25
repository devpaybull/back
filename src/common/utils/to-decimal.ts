import Decimal from 'decimal.js';

const ExactDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_EVEN,
});

export function toDecimal(value: Decimal.Value): Decimal {
  return new ExactDecimal(value);
}
