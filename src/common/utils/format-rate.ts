import Decimal from 'decimal.js';
import { RATE_SCALE } from './rate-scale';
import { roundHalfEven } from './round-half-even';

export function formatRate(value: Decimal): string;
export function formatRate(value: Decimal | null | undefined): string | null;
export function formatRate(value: Decimal | null | undefined): string | null {
  if (value === null || value === undefined) return null;

  return roundHalfEven(value, RATE_SCALE).toFixed(RATE_SCALE);
}
