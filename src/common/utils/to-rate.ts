import Decimal from 'decimal.js';
import { Rate } from '../types/rate';
import { toDecimal } from './to-decimal';

export function toRate(value: Decimal.Value): Rate {
  return toDecimal(value) as Rate;
}
