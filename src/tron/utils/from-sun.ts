import { Crypto } from '../../common/types/crypto';
import { toCrypto } from '../../common/utils/to-crypto';
import { toDecimal } from '../../common/utils/to-decimal';
import { SUN_PER_UNIT } from './sun-per-unit';

export const fromSun = (sun: string | number | bigint): Crypto =>
  toCrypto(toDecimal(String(sun)).div(SUN_PER_UNIT));
