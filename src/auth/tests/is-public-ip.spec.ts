import { isPublicIp } from '../utils/is-public-ip';

describe('isPublicIp', () => {
  it.each(['8.8.8.8', '203.0.113.7', '2a00:1450:4001::1'])(
    'accepts %s',
    (ip) => {
      expect(isPublicIp(ip)).toBe(true);
    },
  );

  it.each([
    '0.0.0.0',
    '10.1.2.3',
    '127.0.0.1',
    '172.31.255.255',
    '192.168.0.1',
    '169.254.0.1',
    '224.0.0.1',
    '::',
    '::1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '',
    'garbage',
  ])('refuses %p', (ip) => {
    expect(isPublicIp(ip)).toBe(false);
  });
});
