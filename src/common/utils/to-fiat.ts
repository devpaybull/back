import Decimal from 'decimal.js';
import { Fiat } from '../types/fiat';
import { toDecimal } from './to-decimal';

export function toFiat(value: Decimal.Value): Fiat {
  return toDecimal(value) as Fiat;
}
