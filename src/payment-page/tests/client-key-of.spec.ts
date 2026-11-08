import { clientKeyOf } from '../utils/client-key-of';

describe('clientKeyOf', () => {
  it('keys an IPv4 client by its address, a mapped one too', () => {
    expect(clientKeyOf('203.0.113.7')).toBe('203.0.113.7');
    expect(clientKeyOf('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  it('keys an IPv6 client by its /64, however it is written', () => {
    expect(clientKeyOf('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64');
    expect(clientKeyOf('2001:0DB8:0001:0002:ffff:ffff:ffff:ffff')).toBe(
      '2001:db8:1:2::/64',
    );
    expect(clientKeyOf('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(clientKeyOf('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
  });

  it('keeps two /64 networks apart', () => {
    expect(clientKeyOf('2001:db8:1:2::1')).not.toBe(
      clientKeyOf('2001:db8:1:3::1'),
    );
  });

  it('puts a request without an address into one bucket and keeps anything else as written', () => {
    expect(clientKeyOf(undefined)).toBe('unknown');
    expect(clientKeyOf('')).toBe('unknown');
    expect(clientKeyOf(' Not-An-IP ')).toBe('not-an-ip');
  });
});
