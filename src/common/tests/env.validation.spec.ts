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
  COUNTERPARTY_MIN_AMOUNT: '5000',
  INSURANCE_PAY_OUT_MIN: '300',
  PLATFORM_MIN_PERCENT: '1',
  DEAL_TTL_MINUTES: '20',
});

describe('validateEnv', () => {
  describe('DEAL_TTL_MINUTES', () => {
    it('reads the deal deadline in minutes', () => {
      expect(validateEnv(baseEnv()).DEAL_TTL_MINUTES).toBe(20);
    });

    it('aborts startup when it is missing — there is no default', () => {
      const { DEAL_TTL_MINUTES, ...without } = baseEnv();

      expect(DEAL_TTL_MINUTES).toBe('20');
      expect(() => validateEnv(without)).toThrow(/DEAL_TTL_MINUTES/);
    });

    it('aborts startup on an empty value rather than reading it as zero', () => {
      expect(() => validateEnv({ ...baseEnv(), DEAL_TTL_MINUTES: '' })).toThrow(
        /DEAL_TTL_MINUTES/,
      );
    });

    it.each(['0', '-5', '1.5', 'soon'])('refuses %p', (value) => {
      expect(() =>
        validateEnv({ ...baseEnv(), DEAL_TTL_MINUTES: value }),
      ).toThrow(/DEAL_TTL_MINUTES/);
    });

    it('accepts one minute', () => {
      expect(
        validateEnv({ ...baseEnv(), DEAL_TTL_MINUTES: '1' }).DEAL_TTL_MINUTES,
      ).toBe(1);
    });
  });

  describe('DEAL_EXPIRY_INTERVAL_SECONDS', () => {
    it('looks for expired deals every 30 seconds by default', () => {
      expect(validateEnv(baseEnv()).DEAL_EXPIRY_INTERVAL_SECONDS).toBe(30);
    });

    it('accepts a typed interval', () => {
      expect(
        validateEnv({ ...baseEnv(), DEAL_EXPIRY_INTERVAL_SECONDS: '5' })
          .DEAL_EXPIRY_INTERVAL_SECONDS,
      ).toBe(5);
    });

    it.each(['0', '-1', '1.5', 'soon'])('refuses %p', (value) => {
      expect(() =>
        validateEnv({ ...baseEnv(), DEAL_EXPIRY_INTERVAL_SECONDS: value }),
      ).toThrow(/DEAL_EXPIRY_INTERVAL_SECONDS/);
    });
  });
  describe('PLATFORM_MIN_PERCENT', () => {
    it('parses a decimal percent', () => {
      expect(
        validateEnv({ ...baseEnv(), PLATFORM_MIN_PERCENT: '1.25' })
          .PLATFORM_MIN_PERCENT,
      ).toBe(1.25);
    });

    it('accepts zero as a real minimum', () => {
      expect(
        validateEnv({ ...baseEnv(), PLATFORM_MIN_PERCENT: '0' })
          .PLATFORM_MIN_PERCENT,
      ).toBe(0);
    });

    it('refuses to boot without it', () => {
      const { PLATFORM_MIN_PERCENT, ...without } = baseEnv();

      expect(PLATFORM_MIN_PERCENT).toBe('1');
      expect(() => validateEnv(without)).toThrow(/PLATFORM_MIN_PERCENT/);
    });

    it('refuses an empty value, which is what .env.example ships', () => {
      expect(() =>
        validateEnv({ ...baseEnv(), PLATFORM_MIN_PERCENT: '' }),
      ).toThrow(/PLATFORM_MIN_PERCENT/);
    });

    it.each(['-0.5', '0.0005', 'abc'])('refuses %s', (value) => {
      expect(() =>
        validateEnv({ ...baseEnv(), PLATFORM_MIN_PERCENT: value }),
      ).toThrow(/PLATFORM_MIN_PERCENT/);
    });
  });

  describe('COUNTERPARTY_MIN_AMOUNT', () => {
    it('parses the floor as a number', () => {
      expect(validateEnv(baseEnv()).COUNTERPARTY_MIN_AMOUNT).toBe(5000);
    });

    it('refuses to boot without it, since there is no sane default floor', () => {
      const { COUNTERPARTY_MIN_AMOUNT, ...withoutFloor } = baseEnv();

      expect(COUNTERPARTY_MIN_AMOUNT).toBe('5000');
      expect(() => validateEnv(withoutFloor)).toThrow(
        /COUNTERPARTY_MIN_AMOUNT/,
      );
    });

    it('refuses an empty value, which is what .env.example ships', () => {
      expect(() =>
        validateEnv({ ...baseEnv(), COUNTERPARTY_MIN_AMOUNT: '' }),
      ).toThrow(/COUNTERPARTY_MIN_AMOUNT/);
    });

    it('refuses a negative floor', () => {
      expect(() =>
        validateEnv({ ...baseEnv(), COUNTERPARTY_MIN_AMOUNT: '-1' }),
      ).toThrow(/COUNTERPARTY_MIN_AMOUNT/);
    });

    it('refuses a fractional floor', () => {
      expect(() =>
        validateEnv({ ...baseEnv(), COUNTERPARTY_MIN_AMOUNT: '10.5' }),
      ).toThrow(/COUNTERPARTY_MIN_AMOUNT/);
    });

    it('takes zero, which is a floor of nothing rather than an absent one', () => {
      expect(
        validateEnv({ ...baseEnv(), COUNTERPARTY_MIN_AMOUNT: '0' })
          .COUNTERPARTY_MIN_AMOUNT,
      ).toBe(0);
    });
  });

  describe('INSURANCE_PAY_OUT_MIN', () => {
    it('refuses more than three decimals', () => {
      expect(() =>
        validateEnv({ ...baseEnv(), INSURANCE_PAY_OUT_MIN: '0.0005' }),
      ).toThrow(/INSURANCE_PAY_OUT_MIN/);
    });

    it('parses a decimal', () => {
      expect(
        validateEnv({ ...baseEnv(), INSURANCE_PAY_OUT_MIN: '250.5' })
          .INSURANCE_PAY_OUT_MIN,
      ).toBe(250.5);
    });

    it('refuses to boot without it', () => {
      const { INSURANCE_PAY_OUT_MIN, ...without } = baseEnv();

      expect(INSURANCE_PAY_OUT_MIN).toBe('300');
      expect(() => validateEnv(without)).toThrow(/INSURANCE_PAY_OUT_MIN/);
    });

    it('refuses an empty value, which is what .env.example ships', () => {
      expect(() =>
        validateEnv({ ...baseEnv(), INSURANCE_PAY_OUT_MIN: '' }),
      ).toThrow(/INSURANCE_PAY_OUT_MIN/);
    });

    it('refuses a negative value and a non-number', () => {
      expect(() =>
        validateEnv({ ...baseEnv(), INSURANCE_PAY_OUT_MIN: '-1' }),
      ).toThrow(/INSURANCE_PAY_OUT_MIN/);
      expect(() =>
        validateEnv({ ...baseEnv(), INSURANCE_PAY_OUT_MIN: 'abc' }),
      ).toThrow(/INSURANCE_PAY_OUT_MIN/);
    });

    it('takes zero as a real minimum', () => {
      expect(
        validateEnv({ ...baseEnv(), INSURANCE_PAY_OUT_MIN: '0' })
          .INSURANCE_PAY_OUT_MIN,
      ).toBe(0);
    });
  });

  describe('night stop', () => {
    it('defaults to 2 open disputes and its own 00-10 Moscow window', () => {
      const env = validateEnv(baseEnv());

      expect(env.NIGHT_STOP_THRESHOLD).toBe(2);
      expect(env.NIGHT_STOP_START_HOUR).toBe(0);
      expect(env.NIGHT_STOP_END_HOUR).toBe(10);
      expect(env.NIGHT_STOP_TIMEZONE).toBe('Europe/Moscow');
    });

    it('accepts the threshold bounds 1 and 10', () => {
      expect(
        validateEnv({ ...baseEnv(), NIGHT_STOP_THRESHOLD: '1' })
          .NIGHT_STOP_THRESHOLD,
      ).toBe(1);
      expect(
        validateEnv({ ...baseEnv(), NIGHT_STOP_THRESHOLD: '10' })
          .NIGHT_STOP_THRESHOLD,
      ).toBe(10);
    });

    it.each(['0', '11', '1.5', 'abc'])('refuses the threshold %s', (value) => {
      expect(() =>
        validateEnv({ ...baseEnv(), NIGHT_STOP_THRESHOLD: value }),
      ).toThrow(/NIGHT_STOP_THRESHOLD/);
    });

    it('refuses hours out of range and an empty timezone', () => {
      expect(() =>
        validateEnv({ ...baseEnv(), NIGHT_STOP_START_HOUR: '24' }),
      ).toThrow(/NIGHT_STOP_START_HOUR/);
      expect(() =>
        validateEnv({ ...baseEnv(), NIGHT_STOP_END_HOUR: '25' }),
      ).toThrow(/NIGHT_STOP_END_HOUR/);
      expect(() =>
        validateEnv({ ...baseEnv(), NIGHT_STOP_TIMEZONE: '' }),
      ).toThrow(/NIGHT_STOP_TIMEZONE/);
    });
  });

  describe('night windows', () => {
    it.each([['NIGHT_STOP'], ['INSURANCE_NIGHT']])(
      'refuses %s start equal to end',
      (prefix) => {
        expect(() =>
          validateEnv({
            ...baseEnv(),
            [`${prefix}_START_HOUR`]: '5',
            [`${prefix}_END_HOUR`]: '5',
          }),
        ).toThrow(new RegExp(`${prefix}_START_HOUR.*${prefix}_END_HOUR`, 's'));
      },
    );

    it('accepts a window that spans midnight', () => {
      const env = validateEnv({
        ...baseEnv(),
        NIGHT_STOP_START_HOUR: '22',
        NIGHT_STOP_END_HOUR: '6',
      });

      expect(env.NIGHT_STOP_START_HOUR).toBe(22);
      expect(env.NIGHT_STOP_END_HOUR).toBe(6);
    });
  });

  describe('time zones', () => {
    it.each([
      'NIGHT_STOP_TIMEZONE',
      'INSURANCE_NIGHT_TIMEZONE',
      'BUSINESS_TIMEZONE',
    ])('refuses a bogus %s', (name) => {
      expect(() =>
        validateEnv({ ...baseEnv(), [name]: 'Europe/Moskow' }),
      ).toThrow(new RegExp(name));
    });

    it('defaults the business timezone to Moscow', () => {
      expect(validateEnv(baseEnv()).BUSINESS_TIMEZONE).toBe('Europe/Moscow');
    });

    it('takes a real IANA zone', () => {
      const env = validateEnv({
        ...baseEnv(),
        NIGHT_STOP_TIMEZONE: 'Asia/Vladivostok',
        INSURANCE_NIGHT_TIMEZONE: 'UTC',
      });

      expect(env.NIGHT_STOP_TIMEZONE).toBe('Asia/Vladivostok');
    });
  });

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
  describe('LOGIN_LINK_TTL_MINUTES', () => {
    it('defaults to fifteen minutes', () => {
      expect(validateEnv(baseEnv()).LOGIN_LINK_TTL_MINUTES).toBe(15);
    });

    it('parses a configured lifetime as a number', () => {
      expect(
        validateEnv({ ...baseEnv(), LOGIN_LINK_TTL_MINUTES: '5' })
          .LOGIN_LINK_TTL_MINUTES,
      ).toBe(5);
    });

    it('accepts the ceiling of an hour', () => {
      expect(
        validateEnv({ ...baseEnv(), LOGIN_LINK_TTL_MINUTES: '60' })
          .LOGIN_LINK_TTL_MINUTES,
      ).toBe(60);
    });

    it.each(['0', '-1', '1.5', 'soon', '', '61', '1440'])(
      'refuses %p',
      (value) => {
        expect(() =>
          validateEnv({ ...baseEnv(), LOGIN_LINK_TTL_MINUTES: value }),
        ).toThrow(/LOGIN_LINK_TTL_MINUTES/);
      },
    );
  });

  describe('GEOIP_DB_PATH', () => {
    it('is empty by default, which means no country lookup', () => {
      expect(validateEnv(baseEnv()).GEOIP_DB_PATH).toBe('');
    });

    it('keeps a configured path as it is', () => {
      expect(
        validateEnv({ ...baseEnv(), GEOIP_DB_PATH: '/data/dbip-country.mmdb' })
          .GEOIP_DB_PATH,
      ).toBe('/data/dbip-country.mmdb');
    });
  });

  describe('audit archive', () => {
    it('is off by default, with the documented interval, batch and retention', () => {
      const env = validateEnv(baseEnv());

      expect(env.VICTORIA_LOGS_URL).toBe('');
      expect(env.AUDIT_ARCHIVE_INTERVAL_SECONDS).toBe(300);
      expect(env.AUDIT_ARCHIVE_BATCH_SIZE).toBe(1000);
      expect(env.AUDIT_RETENTION_DAYS).toBe(30);
    });

    it('accepts a local VictoriaLogs URL and typed numbers', () => {
      const env = validateEnv({
        ...baseEnv(),
        VICTORIA_LOGS_URL: 'http://localhost:9428',
        AUDIT_ARCHIVE_INTERVAL_SECONDS: '60',
        AUDIT_ARCHIVE_BATCH_SIZE: '500',
        AUDIT_RETENTION_DAYS: '7',
      });

      expect(env.VICTORIA_LOGS_URL).toBe('http://localhost:9428');
      expect(env.AUDIT_ARCHIVE_INTERVAL_SECONDS).toBe(60);
      expect(env.AUDIT_ARCHIVE_BATCH_SIZE).toBe(500);
      expect(env.AUDIT_RETENTION_DAYS).toBe(7);
    });

    it('refuses a VictoriaLogs URL that is not a URL', () => {
      expect(() =>
        validateEnv({ ...baseEnv(), VICTORIA_LOGS_URL: 'victoria' }),
      ).toThrow(/VICTORIA_LOGS_URL/);
    });

    it.each([
      'AUDIT_ARCHIVE_INTERVAL_SECONDS',
      'AUDIT_ARCHIVE_BATCH_SIZE',
      'AUDIT_RETENTION_DAYS',
    ])('refuses a zero %s', (name) => {
      expect(() => validateEnv({ ...baseEnv(), [name]: '0' })).toThrow(
        new RegExp(name),
      );
    });
  });

  describe('debt auto write-off', () => {
    it('runs every 60 seconds by default', () => {
      expect(validateEnv(baseEnv()).DEBT_AUTO_WRITE_OFF_INTERVAL_SECONDS).toBe(
        60,
      );
    });

    it('accepts a typed interval', () => {
      expect(
        validateEnv({
          ...baseEnv(),
          DEBT_AUTO_WRITE_OFF_INTERVAL_SECONDS: '15',
        }).DEBT_AUTO_WRITE_OFF_INTERVAL_SECONDS,
      ).toBe(15);
    });

    it.each(['0', '-1', '1.5', 'soon'])('refuses %p', (value) => {
      expect(() =>
        validateEnv({
          ...baseEnv(),
          DEBT_AUTO_WRITE_OFF_INTERVAL_SECONDS: value,
        }),
      ).toThrow(/DEBT_AUTO_WRITE_OFF_INTERVAL_SECONDS/);
    });
  });
});
