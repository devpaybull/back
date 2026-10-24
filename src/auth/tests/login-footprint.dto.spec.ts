import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ConfirmRegistrationDto } from '../dto/confirm-registration.dto';
import { ConfirmTwoFactorSetupDto } from '../dto/confirm-two-factor-setup.dto';
import { LoginDto } from '../dto/login.dto';
import { RedeemLoginLinkDto } from '../dto/redeem-login-link.dto';

const failed = (
  type: new () => object,
  payload: Record<string, unknown>,
): string[] =>
  validateSync(plainToInstance(type, payload)).map((error) => error.property);

describe.each([
  [
    'LoginDto',
    LoginDto,
    { login: 'user@example.com', password: 'password123', totp: '123456' },
  ],
  [
    'ConfirmRegistrationDto',
    ConfirmRegistrationDto,
    { registrationToken: 'token', totp: '123456' },
  ],
  [
    'ConfirmTwoFactorSetupDto',
    ConfirmTwoFactorSetupDto,
    { setupToken: 'token', totp: '123456' },
  ],
  ['RedeemLoginLinkDto', RedeemLoginLinkDto, { code: 'the-code' }],
])('%s fingerprint', (_name, type, base) => {
  it('is optional', () => {
    expect(failed(type, base)).toEqual([]);
  });

  it('accepts up to 128 characters', () => {
    expect(failed(type, { ...base, fingerprint: 'f'.repeat(128) })).toEqual([]);
  });

  it.each([['f'.repeat(129)], [42], [{}]])('refuses %p', (fingerprint) => {
    expect(failed(type, { ...base, fingerprint })).toEqual(['fingerprint']);
  });
});
