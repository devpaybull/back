import { Crypto } from '../../common/types/crypto';
import { SUN_PER_UNIT } from './sun-per-unit';

export const toSun = (amount: Crypto): string =>
  amount.times(SUN_PER_UNIT).toFixed(0);
