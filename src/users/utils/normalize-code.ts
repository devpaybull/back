export const normalizeCode = (code: string): string =>
  code.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
