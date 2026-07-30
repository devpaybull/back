import { CookieOptions } from 'express';

export const REFRESH_COOKIE_NAME = 'refresh_token';
export const REFRESH_COOKIE_PATH = '/auth';

const SECOND_IN_MS = 1000;

const REFRESH_COOKIE_POLICY: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: REFRESH_COOKIE_PATH,
};

export const refreshCookieOptions = (
  maxAgeSeconds?: number,
): CookieOptions => ({
  ...REFRESH_COOKIE_POLICY,
  ...(maxAgeSeconds ? { maxAge: maxAgeSeconds * SECOND_IN_MS } : {}),
});
