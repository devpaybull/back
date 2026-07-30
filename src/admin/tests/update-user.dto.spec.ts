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
