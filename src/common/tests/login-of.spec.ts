import { loginOf } from '../utils/login-of';

describe('loginOf', () => {
  it('takes the telegram username when the account holds both', () => {
    expect(
      loginOf({ email: 'durov@example.com', telegramUsername: 'durov' }),
    ).toBe('durov');
  });

  it('falls back to the email when there is no telegram username', () => {
    expect(
      loginOf({ email: 'durov@example.com', telegramUsername: null }),
    ).toBe('durov@example.com');
  });

  it('falls back to the email when the telegram username is absent', () => {
    expect(loginOf({ email: 'durov@example.com' })).toBe('durov@example.com');
  });

  it('takes the telegram username when there is no email', () => {
    expect(loginOf({ email: null, telegramUsername: 'durov' })).toBe('durov');
  });
});
