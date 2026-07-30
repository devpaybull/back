import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { LoginDto } from '../dto/login.dto';

const failedProperties = (payload: Record<string, unknown>): string[] =>
  validateSync(plainToInstance(LoginDto, payload)).map(
    (error) => error.property,
  );

describe('LoginDto', () => {
  const credentials = { login: 'user@example.com', password: 'password123' };

  it('accepts a six-digit one-time code', () => {
    expect(failedProperties({ ...credentials, totp: '123456' })).toEqual([]);
  });

  it('accepts a backup code instead of a one-time code', () => {
    expect(
      failedProperties({ ...credentials, backupCode: 'AAAAA-BBBBB' }),
    ).toEqual([]);
  });

  it('accepts a telegram username as the login', () => {
    expect(
      failedProperties({ ...credentials, login: '@durov', totp: '123456' }),
    ).toEqual([]);
  });

  it('refuses a login without any second factor', () => {
    expect(failedProperties(credentials)).toEqual(['totp', 'backupCode']);
  });

  it('refuses a malformed one-time code', () => {
    expect(failedProperties({ ...credentials, totp: '12345' })).toEqual([
      'totp',
    ]);
  });

  it('refuses an empty login', () => {
    expect(
      failedProperties({ ...credentials, login: '', totp: '123456' }),
    ).toEqual(['login']);
  });
});
