import { isIP } from 'node:net';

const IPV6_GROUPS = 8;
const IPV4_MAPPED_PREFIX = ['0', '0', '0', '0', '0', 'ffff'];
const DOTTED_TAIL = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/;

const hexPair = (high: string, low: string): string =>
  ((Number(high) << 8) | Number(low)).toString(16);

const canonicalIpv6 = (value: string): string => {
  const dotted = value.match(DOTTED_TAIL);
  const text = dotted
    ? `${value.slice(0, -dotted[0].length)}${hexPair(dotted[1], dotted[2])}:${hexPair(dotted[3], dotted[4])}`
    : value;
  const [head, tail] = text.includes('::') ? text.split('::') : [text];
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups =
    tail === undefined
      ? left
      : [
          ...left,
          ...Array<string>(IPV6_GROUPS - left.length - right.length).fill('0'),
          ...right,
        ];

  const normalized = groups.map((group) => parseInt(group, 16).toString(16));
  const mapped = IPV4_MAPPED_PREFIX.every(
    (group, index) => normalized[index] === group,
  );

  if (!mapped) return normalized.join(':');

  const [high, low] = normalized
    .slice(IPV4_MAPPED_PREFIX.length)
    .map((group) => parseInt(group, 16));

  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
};

export function canonicalIp(raw: string): string | null {
  const value = raw.trim().toLowerCase();

  if (value.includes('%')) return null;

  switch (isIP(value)) {
    case 4:
      return value;
    case 6:
      return canonicalIpv6(value);
    default:
      return null;
  }
}
