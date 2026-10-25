import Decimal from 'decimal.js';
import { FIAT_SCALE } from './fiat-scale';
import { roundHalfEven } from './round-half-even';

export function formatFiat(value: Decimal): string;
export function formatFiat(value: Decimal | null | undefined): string | null;
export function formatFiat(value: Decimal | null | undefined): string | null {
  if (value === null || value === undefined) return null;

  return roundHalfEven(value, FIAT_SCALE).toFixed(FIAT_SCALE);
}
