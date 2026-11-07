import { createHmac } from 'node:crypto';

export const callbackSignature = (
  secret: string,
  timestamp: string,
  body: string,
): string =>
  createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
