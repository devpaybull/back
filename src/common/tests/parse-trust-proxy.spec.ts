import { parseTrustProxy } from '../utils/parse-trust-proxy';

describe('parseTrustProxy', () => {
  it('is off for an empty or explicitly false value', () => {
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('  ')).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy(undefined)).toBe(false);
  });

  it('trusts the whole chain for true', () => {
    expect(parseTrustProxy('true')).toBe(true);
  });

  it('reads a hop count as a number, not a string', () => {
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy(' 2 ')).toBe(2);
    expect(parseTrustProxy('0')).toBe(0);
  });

  it('passes anything else through for Express to interpret', () => {
    expect(parseTrustProxy('loopback')).toBe('loopback');
    expect(parseTrustProxy('192.168.0.1/24')).toBe('192.168.0.1/24');
    expect(parseTrustProxy('1.5')).toBe('1.5');
  });
});
