import { isTronAddress } from '../utils/is-tron-address';

describe('isTronAddress', () => {
  it('accepts a base58check address', () => {
    expect(isTronAddress('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')).toBe(true);
  });

  it('refuses a broken checksum', () => {
    expect(isTronAddress('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6u')).toBe(false);
  });

  it('refuses the hex form and anything not starting with T', () => {
    expect(isTronAddress('41a614f803b6fd780986a42c78ec9c7f77e6ded13c')).toBe(
      false,
    );
    expect(isTronAddress('XR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')).toBe(false);
  });

  it('refuses a wrong length', () => {
    expect(isTronAddress('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6')).toBe(false);
    expect(isTronAddress('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6tt')).toBe(false);
  });

  it('refuses a non-string', () => {
    expect(isTronAddress(42)).toBe(false);
    expect(isTronAddress(null)).toBe(false);
    expect(isTronAddress(undefined)).toBe(false);
  });
});
