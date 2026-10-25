import { BlockList, isIP } from 'node:net';

const NON_PUBLIC = new BlockList();

[
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
].forEach(([network, prefix]) =>
  NON_PUBLIC.addSubnet(network as string, prefix as number, 'ipv4'),
);

[
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
].forEach(([network, prefix]) =>
  NON_PUBLIC.addSubnet(network as string, prefix as number, 'ipv6'),
);

export const isPublicIp = (ip: string): boolean => {
  const family = isIP(ip);

  if (family === 0) return false;

  return !NON_PUBLIC.check(ip, family === 4 ? 'ipv4' : 'ipv6');
};
