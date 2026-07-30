const LEADING_AT = /^@/;

export function normalizeTelegramUsername(username: string): string {
  return username.trim().replace(LEADING_AT, '').toLowerCase();
}
