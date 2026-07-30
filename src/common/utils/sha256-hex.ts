import { createHash } from 'crypto';

export const sha256Hex = (value: string): string =>
  createHash('sha256').update(value).digest('hex');
