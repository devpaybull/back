import { REFRESH_COOKIE_PATH, refreshCookieOptions } from '../refresh-cookie';

describe('refreshCookieOptions', () => {
  it('is httpOnly, secure and same-site, whatever the environment says', () => {
    expect(refreshCookieOptions()).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
    });
  });

  it('keeps the same guarantees when a lifetime is attached', () => {
    expect(refreshCookieOptions(2592000)).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
      maxAge: 2592000 * 1000,
    });
  });

  it('takes no arguments beyond the lifetime, so nothing can weaken it', () => {
    expect(refreshCookieOptions.length).toBe(1);
    expect(refreshCookieOptions()).not.toHaveProperty('domain');
    expect(refreshCookieOptions()).not.toHaveProperty('maxAge');
  });
});
