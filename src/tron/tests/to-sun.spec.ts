import { toCrypto } from '../../common/utils/to-crypto';
import { toSun } from '../utils/to-sun';

describe('toSun', () => {
  it('turns six decimals into whole minor units', () => {
    expect(toSun(toCrypto('12.345678'))).toBe('12345678');
  });

  it('writes a whole amount without a fraction', () => {
    expect(toSun(toCrypto('1'))).toBe('1000000');
    expect(toSun(toCrypto('0'))).toBe('0');
  });

  it('keeps a large amount exact, beyond the precision of a number', () => {
    expect(toSun(toCrypto('999999999999.999999'))).toBe('999999999999999999');
  });
});
