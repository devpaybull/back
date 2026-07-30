import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Role } from '../../common/enums/role.enum';
import { CreateInviteDto } from '../dto/create-invite.dto';

const failedProperties = (payload: Record<string, unknown>): string[] =>
  validateSync(plainToInstance(CreateInviteDto, payload)).map(
    (error) => error.property,
  );

describe('CreateInviteDto', () => {
  const role = { role: Role.Trader };

  it('accepts an email alone', () => {
    expect(failedProperties({ ...role, email: 'user@example.com' })).toEqual(
      [],
    );
  });

  it('accepts a telegram username alone', () => {
    expect(failedProperties({ ...role, telegramUsername: '@durov' })).toEqual(
      [],
    );
  });

  it('accepts a telegram username without the leading at sign', () => {
    expect(failedProperties({ ...role, telegramUsername: 'durov' })).toEqual(
      [],
    );
  });

  it('lets both through, leaving the pair for the service to reject', () => {
    expect(
      failedProperties({
        ...role,
        email: 'user@example.com',
        telegramUsername: '@durov',
      }),
    ).toEqual([]);
  });

  it('lets neither through, leaving the absence for the service to reject', () => {
    expect(failedProperties(role)).toEqual([]);
  });

  it('requires a role', () => {
    expect(failedProperties({ email: 'user@example.com' })).toEqual(['role']);
  });

  it('refuses a role outside the enum', () => {
    expect(
      failedProperties({ role: 'president', email: 'user@example.com' }),
    ).toEqual(['role']);
  });

  it('refuses a malformed email when no telegram username is given', () => {
    expect(failedProperties({ ...role, email: 'not-an-email' })).toEqual([
      'email',
    ]);
  });

  describe('expiresAt', () => {
    const email = { email: 'user@example.com' };

    it('is optional', () => {
      expect(failedProperties({ ...role, ...email })).toEqual([]);
    });

    it('accepts a moment in the future', () => {
      expect(
        failedProperties({
          ...role,
          ...email,
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        }),
      ).toEqual([]);
    });

    it('accepts a moment far in the future, since there is no ceiling', () => {
      expect(
        failedProperties({
          ...role,
          ...email,
          expiresAt: new Date(Date.now() + 3650 * 86400_000).toISOString(),
        }),
      ).toEqual([]);
    });

    it('refuses a moment that has already passed', () => {
      expect(
        failedProperties({
          ...role,
          ...email,
          expiresAt: new Date(Date.now() - 1000).toISOString(),
        }),
      ).toEqual(['expiresAt']);
    });

    it('refuses something that is not a date at all', () => {
      expect(
        failedProperties({ ...role, ...email, expiresAt: 'tomorrow' }),
      ).toEqual(['expiresAt']);
    });

    it('arrives as a Date, not as the string that was sent', () => {
      const dto = plainToInstance(CreateInviteDto, {
        ...role,
        ...email,
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
});
