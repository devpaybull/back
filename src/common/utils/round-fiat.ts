import Decimal from 'decimal.js';
import { Fiat } from '../types/fiat';
import { FIAT_SCALE } from './fiat-scale';
import { roundHalfEven } from './round-half-even';

export function roundFiat(value: Decimal.Value): Fiat {
  return roundHalfEven(value, FIAT_SCALE) as Fiat;
}
