export function parseTrustProxy(raw: string): boolean | number | string {
  const value = (raw ?? '').trim();
  if (value === '' || value === 'false') return false;
  if (value === 'true') return true;

  const proxyHops = Number(value);

  return Number.isInteger(proxyHops) ? proxyHops : value;
}
