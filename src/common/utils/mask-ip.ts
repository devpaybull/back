import { isIP } from 'node:net';

const IPV4_KEPT_OCTETS = 2;
const IPV6_KEPT_GROUPS = 4;

export function maskIp(ip: string): string {
  return isIP(ip) === 4
    ? [...ip.split('.').slice(0, IPV4_KEPT_OCTETS), '*', '*'].join('.')
    : [
        ...ip.split(':').slice(0, IPV6_KEPT_GROUPS),
        ...Array<string>(IPV6_KEPT_GROUPS).fill('*'),
      ].join(':');
}
