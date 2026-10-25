import Decimal from 'decimal.js';
import { Rate } from '../types/rate';
import { RATE_SCALE } from './rate-scale';
import { roundHalfEven } from './round-half-even';

export function roundRate(value: Decimal.Value): Rate {
  return roundHalfEven(value, RATE_SCALE) as Rate;
}
