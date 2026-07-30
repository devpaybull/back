import { Request } from 'express';
import { REFRESH_COOKIE_NAME } from '../refresh-cookie';

export const readRefreshCookie = (request: Request): string =>
  request.cookies?.[REFRESH_COOKIE_NAME];
