import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Role } from '../../common/enums/role.enum';
import { uuidOf } from '../../common/tests/uuid-of.spec';
import { CreateInviteDto } from '../dto/create-invite.dto';

const failedProperties = (payload: Record<string, unknown>): string[] =>
  validateSync(plainToInstance(CreateInviteDto, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  }).map((error) => error.property);

describe('CreateInviteDto', () => {
  const role = { role: Role.Trader };

  it('accepts a telegram username', () => {
    expect(failedProperties({ ...role, telegramUsername: '@durov' })).toEqual(
      [],
    );
  });

  it('accepts a telegram username without the leading at sign', () => {
    expect(failedProperties({ ...role, telegramUsername: 'durov' })).toEqual(
      [],
    );
  });

  it('requires a telegram username', () => {
    expect(failedProperties(role)).toEqual(['telegramUsername']);
  });

  it('refuses an email, since an invite carries a telegram username only', () => {
    expect(
      failedProperties({
        ...role,
        email: 'user@example.com',
        telegramUsername: '@durov',
      }),
    ).toEqual(['email']);
  });

  it('refuses an email given instead of a telegram username', () => {
    expect(
      failedProperties({ ...role, email: 'user@example.com' }).sort(),
    ).toEqual(['email', 'telegramUsername']);
  });

  it('requires a role', () => {
    expect(failedProperties({ telegramUsername: 'durov' })).toEqual(['role']);
  });

  it('refuses a role outside the enum', () => {
    expect(
      failedProperties({ role: 'president', telegramUsername: 'durov' }),
    ).toEqual(['role']);
  });

  describe('expiresAt', () => {
    const nick = { telegramUsername: 'durov' };

    it('is optional', () => {
      expect(failedProperties({ ...role, ...nick })).toEqual([]);
    });

    it('accepts a moment in the future', () => {
      expect(
        failedProperties({
          ...role,
          ...nick,
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        }),
      ).toEqual([]);
    });

    it('accepts a moment far in the future, since there is no ceiling', () => {
      expect(
        failedProperties({
          ...role,
          ...nick,
          expiresAt: new Date(Date.now() + 3650 * 86400_000).toISOString(),
        }),
      ).toEqual([]);
    });

    it('refuses a moment that has already passed', () => {
      expect(
        failedProperties({
          ...role,
          ...nick,
          expiresAt: new Date(Date.now() - 1000).toISOString(),
        }),
      ).toEqual(['expiresAt']);
    });

    it('refuses something that is not a date at all', () => {
      expect(
        failedProperties({ ...role, ...nick, expiresAt: 'tomorrow' }),
      ).toEqual(['expiresAt']);
    });

    it('arrives as a Date, not as the string that was sent', () => {
      const dto = plainToInstance(CreateInviteDto, {
        ...role,
        ...nick,
        expiresAt: '2030-01-01T00:00:00.000Z',
      });

      expect(dto.expiresAt).toBeInstanceOf(Date);
      expect(dto.expiresAt.toISOString()).toBe('2030-01-01T00:00:00.000Z');
    });
  });

  it.each([
    ['1durov', 'starts with a digit'],
    ['durv', 'is shorter than five characters'],
    ['d'.repeat(33), 'is longer than thirty-two characters'],
    ['du.rov', 'contains a dot'],
    ['@@durov', 'repeats the at sign'],
  ])('refuses %s because it %s', (telegramUsername) => {
    expect(failedProperties({ ...role, telegramUsername })).toEqual([
      'telegramUsername',
    ]);
  });

  describe('merchantId', () => {
    const nick = { telegramUsername: 'durov' };

    it('is optional, leaving the role rules to the service', () => {
      expect(failedProperties({ role: Role.MerchantSupport, ...nick })).toEqual(
        [],
      );
    });

    it('accepts a uuid', () => {
      expect(
        failedProperties({
          role: Role.MerchantAgent,
          ...nick,
          merchantId: uuidOf(50),
        }),
      ).toEqual([]);
    });

    it('refuses anything that is not a uuid', () => {
      expect(
        failedProperties({
          role: Role.MerchantAgent,
          ...nick,
          merchantId: '5',
        }),
      ).toEqual(['merchantId']);
    });
  });
});

describe('CreateInviteDto message for a past expiresAt', () => {
  it('says the moment must be in the future instead of printing the bound function', () => {
    const errors = validateSync(
      plainToInstance(CreateInviteDto, {
        role: Role.Trader,
        telegramUsername: 'durov',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }),
    );

    expect(
      errors.flatMap((error) => Object.values(error.constraints ?? {})),
    ).toEqual(['expiresAt must be a moment in the future']);
  });
});
