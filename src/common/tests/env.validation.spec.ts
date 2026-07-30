import 'reflect-metadata';
import { validateEnv } from '../config/env.validation';

const SECRET = 'a-secret-that-is-at-least-32-characters';

const baseEnv = (): Record<string, unknown> => ({
  DB_HOST: '127.0.0.1',
  DB_USERNAME: 'paybull',
  DB_NAME: 'paybull',
  JWT_ACCESS_SECRET: SECRET,
  JWT_REFRESH_SECRET: SECRET,
  JWT_REGISTRATION_SECRET: SECRET,
});

describe('validateEnv', () => {
  it('boots with no mail configuration at all', () => {
    const env = validateEnv(baseEnv());

    expect(env.MAIL_HOST).toBe('');
    expect(env.MAIL_FROM).toBe('');
  });

  it('requires a sender once a host is configured', () => {
    expect(() =>
      validateEnv({ ...baseEnv(), MAIL_HOST: 'smtp.example.com' }),
    ).toThrow(/MAIL_FROM is required when MAIL_HOST is set/);
  });

  it('accepts a complete mail configuration', () => {
    const env = validateEnv({
      ...baseEnv(),
      MAIL_HOST: 'smtp.example.com',
      MAIL_FROM: 'no-reply@example.com',
    });

    expect(env.MAIL_PORT).toBe(587);
    expect(env.MAIL_SECURE).toBe(false);
  });

  it('refuses a short JWT secret', () => {
    expect(() =>
      validateEnv({ ...baseEnv(), JWT_ACCESS_SECRET: 'too-short' }),
    ).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('refuses a missing database name', () => {
    const { DB_NAME, ...withoutName } = baseEnv();

    expect(() => validateEnv(withoutName)).toThrow(/DB_NAME/);
    expect(DB_NAME).toBe('paybull');
  });
});
