import { maskIp } from '../utils/mask-ip';

describe('maskIp', () => {
  it('hides the last two octets of an IPv4 address', () => {
    expect(maskIp('203.0.113.47')).toBe('203.0.*.*');
  });

  it('hides the last four groups of a full IPv6 address', () => {
    expect(maskIp('2001:db8:0:0:0:0:0:1')).toBe('2001:db8:0:0:*:*:*:*');
  });

  it.each([
    ['::ffff:203.0.113.7', '203.0.*.*'],
    ['::ffff:cb00:7107', '203.0.*.*'],
    ['2001:db8::1', '2001:db8:0:0:*:*:*:*'],
    ['2001:DB8:1:2:3:4:5:6', '2001:db8:1:2:*:*:*:*'],
    ['::1', '0:0:0:0:*:*:*:*'],
    ['64:ff9b::203.0.113.7', '64:ff9b:0:0:*:*:*:*'],
  ])('masks the raw form %s as %s', (raw, masked) => {
    expect(maskIp(raw)).toBe(masked);
  });

  it.each(['unknown', '', 'fe80::1%eth0'])(
    'shows nothing of %j, which is not an address',
    (raw) => {
      expect(maskIp(raw)).toBe('*');
    },
  );
});
