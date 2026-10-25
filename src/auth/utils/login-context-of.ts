import { Request } from 'express';
import { LoginContext } from '../types/login-context';

export const loginContextOf = (
  request: Request,
  fingerprint?: string,
): LoginContext => ({
  ip: request.ip ?? null,
  userAgent: request.get('user-agent') ?? null,
  fingerprint: fingerprint ?? null,
});
