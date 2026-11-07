import { CallbackUrlRefusedError } from '../types/callback-http-client';
import { assertPublicAddress } from '../utils/assert-public-address';

describe('assertPublicAddress', () => {
  it.each([
    '0.0.0.0',
    '10.1.2.3',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '198.18.0.1',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:169.254.169.254',
    '64:ff9b::7f00:1',
    '::127.0.0.1',
    '2002:7f00:1::',
    'fec0::1',
    '64:ff9b:1::1',
    '2001:0:1::1',
    'not-an-address',
    'fe80::1%eth0',
  ])('refuses %s', (address) => {
    expect(() => assertPublicAddress(address)).toThrow(CallbackUrlRefusedError);
  });

  it.each(['8.8.8.8', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    'lets %s through',
    (address) => {
      expect(() => assertPublicAddress(address)).not.toThrow();
    },
  );
});
