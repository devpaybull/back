import { canonicalIp } from '../utils/canonical-ip';

describe('canonicalIp', () => {
  it.each([
    ['203.0.113.47', '203.0.113.47'],
    [' 203.0.113.47 ', '203.0.113.47'],
    ['2001:DB8::1', '2001:db8:0:0:0:0:0:1'],
    ['2001:0db8:0000:0000:0000:ff00:0042:8329', '2001:db8:0:0:0:ff00:42:8329'],
    ['::', '0:0:0:0:0:0:0:0'],
    ['::1', '0:0:0:0:0:0:0:1'],
    ['64:ff9b::203.0.113.7', '64:ff9b:0:0:0:0:cb00:7107'],
    ['::ffff:203.0.113.7', '203.0.113.7'],
    ['::FFFF:203.0.113.7', '203.0.113.7'],
    ['::ffff:cb00:7107', '203.0.113.7'],
    ['0:0:0:0:0:ffff:cb00:7107', '203.0.113.7'],
  ])('writes %s as %s', (raw, canonical) => {
    expect(canonicalIp(raw)).toBe(canonical);
  });

  it.each(['', 'unknown', '999.0.0.1', 'fe80::1%eth0', '2001:db8::1::2'])(
    'refuses %j as an address',
    (raw) => {
      expect(canonicalIp(raw)).toBeNull();
    },
  );
});
