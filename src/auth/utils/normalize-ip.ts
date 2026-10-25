const IPV4_MAPPED_PREFIX = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

export const normalizeIp = (ip: string): string => {
  const trimmed = ip.trim();
  const mapped = IPV4_MAPPED_PREFIX.exec(trimmed);

  return mapped ? mapped[1] : trimmed;
};
