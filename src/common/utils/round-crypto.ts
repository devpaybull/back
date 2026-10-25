import Decimal from 'decimal.js';
import { Crypto } from '../types/crypto';
import { CRYPTO_SCALE } from './crypto-scale';
import { roundHalfEven } from './round-half-even';

export function roundCrypto(value: Decimal.Value): Crypto {
  return roundHalfEven(value, CRYPTO_SCALE) as Crypto;
}
