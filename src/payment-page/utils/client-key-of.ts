import { canonicalIp } from '../../common/utils/canonical-ip';

const IPV6_NETWORK_GROUPS = 4;
const UNKNOWN_CLIENT = 'unknown';
const IPV4_EMBEDDING_PREFIXES: readonly string[] = [
  '0:0:0:0:0:0',
  '0:0:0:0:ffff:0',
  '64:ff9b:0:0:0:0',
];

const embeddedIpv4 = (groups: string[]): string | null => {
  if (!IPV4_EMBEDDING_PREFIXES.includes(groups.slice(0, 6).join(':'))) {
    return null;
  }

  const [high, low] = groups.slice(6).map((group) => parseInt(group, 16));

  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
};

export function clientKeyOf(ip: string | undefined): string {
  if (!ip) return UNKNOWN_CLIENT;

  const canonical = canonicalIp(ip.split('%')[0]);

  if (!canonical) return ip.trim().toLowerCase();
  if (!canonical.includes(':')) return canonical;

  const groups = canonical.split(':');

  return (
    embeddedIpv4(groups) ??
    `${groups.slice(0, IPV6_NETWORK_GROUPS).join(':')}::/64`
  );
}
