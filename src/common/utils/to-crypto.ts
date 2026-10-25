import Decimal from 'decimal.js';
import { Crypto } from '../types/crypto';
import { toDecimal } from './to-decimal';

export function toCrypto(value: Decimal.Value): Crypto {
  return toDecimal(value) as Crypto;
}
