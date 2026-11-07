import { isIP } from 'node:net';
import { canonicalIp } from './canonical-ip';

const IPV4_KEPT_OCTETS = 2;
const IPV6_KEPT_GROUPS = 4;
const NOT_AN_ADDRESS_MASK = '*';

export function maskIp(ip: string): string {
  const canonical = canonicalIp(ip);

  if (canonical === null) return NOT_AN_ADDRESS_MASK;

  return isIP(canonical) === 4
    ? [...canonical.split('.').slice(0, IPV4_KEPT_OCTETS), '*', '*'].join('.')
    : [
        ...canonical.split(':').slice(0, IPV6_KEPT_GROUPS),
        ...Array<string>(IPV6_KEPT_GROUPS).fill('*'),
      ].join(':');
}
