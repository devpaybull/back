import { TronWeb } from 'tronweb';

export const isTronAddress = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length === 34 &&
  value.startsWith('T') &&
  TronWeb.isAddress(value);
