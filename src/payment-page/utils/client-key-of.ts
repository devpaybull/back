import { canonicalIp } from '../../common/utils/canonical-ip';

const IPV6_NETWORK_GROUPS = 4;
const UNKNOWN_CLIENT = 'unknown';

export function clientKeyOf(ip: string | undefined): string {
  if (!ip) return UNKNOWN_CLIENT;

  const canonical = canonicalIp(ip.split('%')[0]);

  if (!canonical) return ip.trim().toLowerCase();
  if (!canonical.includes(':')) return canonical;

  return `${canonical.split(':').slice(0, IPV6_NETWORK_GROUPS).join(':')}::/64`;
}
