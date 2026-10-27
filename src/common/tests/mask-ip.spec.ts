import { maskIp } from '../utils/mask-ip';

describe('maskIp', () => {
  it('hides the last two octets of an IPv4 address', () => {
    expect(maskIp('203.0.113.47')).toBe('203.0.*.*');
  });

  it('hides the last four groups of a full IPv6 address', () => {
    expect(maskIp('2001:db8:0:0:0:0:0:1')).toBe('2001:db8:0:0:*:*:*:*');
  });
});
