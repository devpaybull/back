import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Role } from '../../common/enums/role.enum';
import { UserStatus } from '../../users/types/user-status.enum';
import { UpdateUserDto } from '../dto/update-user.dto';

const failedProperties = (payload: Record<string, unknown>): string[] =>
  validateSync(plainToInstance(UpdateUserDto, payload)).map(
    (error) => error.property,
  );

describe('UpdateUserDto', () => {
  it('accepts an empty payload, leaving it for the controller to reject', () => {
    expect(failedProperties({})).toEqual([]);
  });

  it('accepts an email and a telegram username together', () => {
    expect(
      failedProperties({
        email: 'user@example.com',
        telegramUsername: '@durov',
      }),
    ).toEqual([]);
  });

  it('accepts every field at once', () => {
    expect(
      failedProperties({
        email: 'user@example.com',
        telegramUsername: 'durov',
        role: Role.LeadTrader,
        password: 'correct horse battery',
        status: UserStatus.Suspended,
        resetTwoFactor: true,
      }),
    ).toEqual([]);
  });

  describe('null on a field that cannot be cleared', () => {
    it.each([
      'email',
      'telegramUsername',
      'role',
      'password',
      'status',
      'resetTwoFactor',
    ])('refuses null for %s', (field) => {
      expect(failedProperties({ [field]: null })).toEqual([field]);
    });
  });

  describe('telegramId', () => {
    it.each(['1', '123456789', '123456789012345678'])('accepts %s', (value) => {
      expect(failedProperties({ telegramId: value })).toEqual([]);
    });

    it('accepts null, which clears it', () => {
      expect(failedProperties({ telegramId: null })).toEqual([]);
    });

    it.each([
      '',
      'abc',
      '12a',
      '-5',
      '+5',
      '0',
      '012',
      '1.5',
      '1234567890123456789',
    ])('refuses %p', (value) => {
      expect(failedProperties({ telegramId: value })).toEqual(['telegramId']);
    });

    it('refuses a JSON number', () => {
      expect(failedProperties({ telegramId: 123 })).toEqual(['telegramId']);
    });
  });

  describe('telegramGroups', () => {
    it('accepts free text', () => {
      expect(
        failedProperties({ telegramGroups: 'traders2026 / paybull_push' }),
      ).toEqual([]);
    });

    it('accepts an empty string and null, which clear it', () => {
      expect(failedProperties({ telegramGroups: '' })).toEqual([]);
      expect(failedProperties({ telegramGroups: null })).toEqual([]);
    });

    it('trims it', () => {
      expect(
        plainToInstance(UpdateUserDto, { telegramGroups: '  a / b ' })
          .telegramGroups,
      ).toBe('a / b');
    });

    it('accepts 255 characters and refuses 256', () => {
      expect(failedProperties({ telegramGroups: 'x'.repeat(255) })).toEqual([]);
      expect(failedProperties({ telegramGroups: 'x'.repeat(256) })).toEqual([
        'telegramGroups',
      ]);
    });

    it('refuses a non-string', () => {
      expect(failedProperties({ telegramGroups: ['a'] })).toEqual([
        'telegramGroups',
      ]);
    });
  });

  it('refuses a malformed email', () => {
    expect(failedProperties({ email: 'not-an-email' })).toEqual(['email']);
  });

  it.each([
    ['1durov', 'starts with a digit'],
    ['durv', 'is shorter than five characters'],
    ['d'.repeat(33), 'is longer than thirty-two characters'],
    ['du.rov', 'contains a dot'],
    ['@@durov', 'repeats the at sign'],
  ])('refuses %s because it %s', (telegramUsername) => {
    expect(failedProperties({ telegramUsername })).toEqual([
      'telegramUsername',
    ]);
  });

  it('refuses a role outside the enum', () => {
    expect(failedProperties({ role: 'president' })).toEqual(['role']);
  });

  it('refuses a status outside the enum', () => {
    expect(failedProperties({ status: 'vanished' })).toEqual(['status']);
  });

  it.each([['short12'], ['x'.repeat(129)]])(
    'refuses the password %#',
    (password) => {
      expect(failedProperties({ password })).toEqual(['password']);
    },
  );

  it('refuses a non-boolean two-factor reset', () => {
    expect(failedProperties({ resetTwoFactor: 'yes' })).toEqual([
      'resetTwoFactor',
    ]);
  });
});
