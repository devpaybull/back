const CORS_DISABLED = '';
const CORS_ANY_ORIGIN = '*';

export function parseCorsOrigin(raw: string): boolean | string[] {
  const value = (raw ?? '').trim();
  if (value === CORS_DISABLED) return false;
  if (value === CORS_ANY_ORIGIN) return true;

  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}
