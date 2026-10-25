import Decimal from 'decimal.js';
import { CRYPTO_SCALE } from './crypto-scale';
import { roundHalfEven } from './round-half-even';

export function formatCrypto(value: Decimal): string;
export function formatCrypto(value: Decimal | null | undefined): string | null;
export function formatCrypto(value: Decimal | null | undefined): string | null {
  if (value === null || value === undefined) return null;

  return roundHalfEven(value, CRYPTO_SCALE).toFixed(CRYPTO_SCALE);
}
