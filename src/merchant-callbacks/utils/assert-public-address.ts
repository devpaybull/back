import { BlockList, isIP } from 'node:net';
import { canonicalIp } from '../../common/utils/canonical-ip';
import { CallbackUrlRefusedError } from '../types/callback-http-client';

const REFUSED = new BlockList();

for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  REFUSED.addSubnet(network, prefix, 'ipv4');
}

for (const [network, prefix] of [
  ['::', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['2001::', 32],
  ['2002::', 16],
  ['fec0::', 10],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  REFUSED.addSubnet(network, prefix, 'ipv6');
}

export function assertPublicAddress(address: string): void {
  const canonical = canonicalIp(address);

  if (
    canonical === null ||
    REFUSED.check(canonical, isIP(canonical) === 4 ? 'ipv4' : 'ipv6')
  ) {
    throw new CallbackUrlRefusedError(
      `The callback address ${address} is not public`,
    );
  }
}
