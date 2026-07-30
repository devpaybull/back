import { toAccountIdentifier } from '../utils/to-account-identifier';

describe('toAccountIdentifier', () => {
  it('reads a login with an inner at sign as an email', () => {
    expect(toAccountIdentifier('user@example.com')).toEqual({
      email: 'user@example.com',
    });
  });

  it('normalizes the email it reads', () => {
    expect(toAccountIdentifier('  User@Example.COM ')).toEqual({
      email: 'user@example.com',
    });
  });

  it('reads a login with a leading at sign as a telegram username', () => {
    expect(toAccountIdentifier('@durov')).toEqual({
      telegramUsername: 'durov',
    });
  });

  it('reads a login without any at sign as a telegram username', () => {
    expect(toAccountIdentifier('durov')).toEqual({
      telegramUsername: 'durov',
    });
  });

  it('normalizes the telegram username it reads', () => {
    expect(toAccountIdentifier(' @Durov ')).toEqual({
      telegramUsername: 'durov',
    });
  });

  it('ignores whitespace when deciding where the at sign sits', () => {
    expect(toAccountIdentifier('   @durov')).toEqual({
      telegramUsername: 'durov',
    });
  });

  it('reads a leading at sign followed by an inner one as an email', () => {
    expect(toAccountIdentifier('@user@example.com')).toEqual({
      email: '@user@example.com',
    });
  });

  it('never returns both kinds at once', () => {
    expect(
      toAccountIdentifier('user@example.com').telegramUsername,
    ).toBeUndefined();
    expect(toAccountIdentifier('durov').email).toBeUndefined();
  });
});
