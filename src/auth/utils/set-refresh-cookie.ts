import { Response } from 'express';
import { REFRESH_COOKIE_NAME, refreshCookieOptions } from '../refresh-cookie';
import { IssuedSession } from '../types/token-payloads';

export const setRefreshCookie = (
  response: Response,
  session: IssuedSession,
): void => {
  response.cookie(
    REFRESH_COOKIE_NAME,
    session.refreshToken,
    refreshCookieOptions(session.refreshExpiresIn),
  );
};
