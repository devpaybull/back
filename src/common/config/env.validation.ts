import { IsCryptoAmount } from '../decorators/is-crypto-amount.decorator';
import { IsFiatAmount } from '../decorators/is-fiat-amount.decorator';
import { IsIanaTimeZone } from './is-iana-time-zone';
import { plainToInstance, Transform, Type } from 'class-transformer';
import { utils } from 'tronweb';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
  MinLength,
  ValidateIf,
  validateSync,
  ValidationError,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

const MIN_SECRET_LENGTH = 32;
const TRON_ADDRESS_PATTERN = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
export const TRON_NETWORKS = ['mainnet', 'nile', 'shasta'] as const;
export const PAYOUT_MODES = ['auto', 'manual'] as const;
export const KEY_SOURCES = ['vault', 'env'] as const;
const PRIVATE_KEY_PATTERN = /^(0x)?[0-9a-fA-F]{64}$/;
export const MAINNET_USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const SECURE_URL_VARIABLES = ['TRON_API_URL', 'VAULT_ADDR'] as const;
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

const isSecureUrl = (value: unknown, production: boolean): boolean => {
  if (typeof value !== 'string') return true;

  try {
    const url = new URL(value);

    return (
      url.protocol === 'https:' ||
      (!production &&
        url.protocol === 'http:' &&
        LOOPBACK_HOSTS.includes(url.hostname))
    );
  } catch {
    return true;
  }
};
const NIGHT_WINDOW_PREFIXES = ['NIGHT_STOP', 'INSURANCE_NIGHT'] as const;
const TRUE_VALUES = ['true', '1', 'yes'];
const FALSE_VALUES = ['false', '0', 'no'];

const ToBoolean = () =>
  Transform(({ value }) => {
    if (typeof value === 'boolean') return value;
    if (value === undefined || value === null || value === '') return undefined;

    const normalized = String(value).trim().toLowerCase();
    if (TRUE_VALUES.includes(normalized)) return true;
    if (FALSE_VALUES.includes(normalized)) return false;

    return value;
  });

const ToRequiredString = () =>
  Transform(({ value }) => {
    if (value === undefined || value === null) return undefined;

    const trimmed = String(value).trim();

    return trimmed === '' ? undefined : trimmed;
  });

const usesVault = (env: EnvironmentVariables): boolean =>
  env.KEY_SOURCE === 'vault';
const usesEnvKeys = (env: EnvironmentVariables): boolean =>
  env.KEY_SOURCE === 'env';

const ToRequiredNumber = () =>
  Transform(({ value }) => {
    if (typeof value === 'number') return value;
    if (value === undefined || value === null || String(value).trim() === '') {
      return undefined;
    }

    return Number(value);
  });

export class EnvironmentVariables {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsString()
  @IsNotEmpty()
  DB_HOST: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  DB_PORT: number = 5432;

  @IsString()
  @IsNotEmpty()
  DB_USERNAME: string;

  @IsString()
  DB_PASSWORD: string = '';

  @IsString()
  @IsNotEmpty()
  DB_NAME: string;

  @ToBoolean()
  @IsBoolean()
  DB_SYNCHRONIZE: boolean = false;

  @ToBoolean()
  @IsBoolean()
  DB_SSL: boolean = false;

  @ToBoolean()
  @IsBoolean()
  DB_LOGGING: boolean = false;

  @IsString()
  CORS_ORIGIN: string = '';

  @ToBoolean()
  @IsBoolean()
  CORS_CREDENTIALS: boolean = false;

  @IsString()
  TRUST_PROXY: string = 'false';

  @IsString()
  @MinLength(MIN_SECRET_LENGTH)
  JWT_ACCESS_SECRET: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  JWT_ACCESS_TTL_SECONDS: number = 900;

  @IsString()
  @MinLength(MIN_SECRET_LENGTH)
  JWT_REFRESH_SECRET: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  JWT_REFRESH_TTL_SECONDS: number = 2592000;

  @IsString()
  @MinLength(MIN_SECRET_LENGTH)
  JWT_REGISTRATION_SECRET: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  JWT_REGISTRATION_TTL_SECONDS: number = 900;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  EMAIL_CONFIRMATION_TTL_SECONDS: number = 900;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  PASSWORD_RESET_TTL_MINUTES: number = 15;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  LOGIN_LINK_TTL_MINUTES: number = 15;

  @IsString()
  APP_URL: string = '';

  @IsString()
  GEOIP_DB_PATH: string = '';

  @IsString()
  @IsNotEmpty()
  TOTP_ISSUER: string = 'Paybull';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  INVITE_TTL_HOURS: number = 72;

  @ToRequiredString()
  @IsFiatAmount()
  COUNTERPARTY_MIN_AMOUNT: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  RATE_MARKUP: number = 0.01;

  @ToRequiredNumber()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  PLATFORM_MIN_PERCENT: number;

  @ToRequiredNumber()
  @IsInt()
  @Min(1)
  DEAL_TTL_MINUTES: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  DEAL_EXPIRY_INTERVAL_SECONDS: number = 30;

  @IsString()
  @IsNotEmpty()
  RAPIRA_RATE_URL: string = 'https://api.rapira.net/open/market/rates';

  @IsString()
  @IsNotEmpty()
  RAPIRA_RATE_SYMBOL: string = 'USDT/RUB';

  @Type(() => Number)
  @IsInt()
  @Min(0)
  RAPIRA_RATE_TTL_SECONDS: number = 60;

  @ToRequiredString()
  @IsCryptoAmount()
  MAIN_BALANCE_MIN_THRESHOLD: string = '0';

  @ToRequiredString()
  @IsCryptoAmount()
  INSURANCE_PAY_IN_MIN: string = '500';

  @ToRequiredString()
  @IsCryptoAmount()
  INSURANCE_PAY_OUT_MIN: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  INSURANCE_WITHDRAWAL_DELAY_DAYS: number = 14;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(23)
  INSURANCE_NIGHT_START_HOUR: number = 0;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  INSURANCE_NIGHT_END_HOUR: number = 10;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  NIGHT_STOP_THRESHOLD: number = 2;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(23)
  NIGHT_STOP_START_HOUR: number = 0;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  NIGHT_STOP_END_HOUR: number = 10;

  @IsString()
  @IsNotEmpty()
  @IsIanaTimeZone()
  BUSINESS_TIMEZONE: string = 'Europe/Moscow';

  @IsString()
  MAIL_HOST: string = '';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  MAIL_PORT: number = 587;

  @ToBoolean()
  @IsBoolean()
  MAIL_SECURE: boolean = false;

  @IsString()
  MAIL_USER: string = '';

  @IsString()
  MAIL_PASSWORD: string = '';

  @ValidateIf((env: EnvironmentVariables) => Boolean(env.MAIL_HOST))
  @IsString()
  @IsNotEmpty({ message: 'MAIL_FROM is required when MAIL_HOST is set' })
  MAIL_FROM: string = '';

  @ValidateIf((env: EnvironmentVariables) => Boolean(env.VICTORIA_LOGS_URL))
  @IsUrl({ require_tld: false, require_protocol: true })
  VICTORIA_LOGS_URL: string = '';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  AUDIT_ARCHIVE_INTERVAL_SECONDS: number = 300;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  AUDIT_ARCHIVE_BATCH_SIZE: number = 1000;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  AUDIT_RETENTION_DAYS: number = 30;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  DEBT_AUTO_WRITE_OFF_INTERVAL_SECONDS: number = 60;

  @IsIn(TRON_NETWORKS)
  TRON_NETWORK: (typeof TRON_NETWORKS)[number];

  @IsUrl({ require_tld: false, require_protocol: true })
  TRON_API_URL: string;

  @ToRequiredString()
  @IsString()
  @IsNotEmpty()
  TRON_API_KEY: string;

  @Matches(TRON_ADDRESS_PATTERN)
  TRON_USDT_CONTRACT: string;

  @IsIn(KEY_SOURCES)
  KEY_SOURCE: (typeof KEY_SOURCES)[number] = 'vault';

  @ValidateIf(usesVault)
  @IsUrl({ require_tld: false, require_protocol: true })
  VAULT_ADDR: string;

  @ValidateIf(usesVault)
  @ToRequiredString()
  @IsString()
  @IsNotEmpty()
  VAULT_ROLE_ID: string;

  @ValidateIf(usesVault)
  @ToRequiredString()
  @IsString()
  @IsNotEmpty()
  VAULT_SECRET_ID: string;

  @ValidateIf(usesVault)
  @ToRequiredString()
  @IsString()
  @IsNotEmpty()
  VAULT_TRANSIT_KEY: string;

  @ValidateIf(usesVault)
  @Matches(/^vault:v\d+:/)
  TRON_DEPOSIT_SEED_CIPHERTEXT: string;

  @ValidateIf(usesVault)
  @Matches(/^vault:v\d+:/)
  TRON_HOT_KEY_CIPHERTEXT: string;

  @ValidateIf(usesVault)
  @Matches(/^vault:v\d+:/)
  TRON_ENERGY_KEY_CIPHERTEXT: string;

  @ValidateIf(usesEnvKeys)
  @ToRequiredString()
  @IsString({ message: '$property must be a BIP-39 mnemonic' })
  TRON_DEPOSIT_MNEMONIC: string;

  @ValidateIf(usesEnvKeys)
  @ToRequiredString()
  @Matches(PRIVATE_KEY_PATTERN, {
    message: '$property must be 64 hex characters',
  })
  TRON_HOT_PRIVATE_KEY: string;

  @ValidateIf(usesEnvKeys)
  @ToRequiredString()
  @Matches(PRIVATE_KEY_PATTERN, {
    message: '$property must be 64 hex characters',
  })
  TRON_ENERGY_PRIVATE_KEY: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  TRON_SCAN_INTERVAL_SECONDS: number = 3;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  TRON_SCAN_BATCH_BLOCKS: number = 100;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  TRON_SCAN_MAX_LAG_BLOCKS: number = 200;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  TRON_CHAIN_PARAMS_TTL_SECONDS: number = 600;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  TRON_CONFIRM_INTERVAL_SECONDS: number = 10;

  @ToRequiredString()
  @IsCryptoAmount({ positive: true })
  TRON_MAX_TRX_BURN_PER_TX: string;

  @ToRequiredString()
  @IsCryptoAmount({ positive: true })
  SWEEP_MIN_USDT: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  SWEEP_MAX_IDLE_HOURS: number = 24;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  SWEEP_INTERVAL_SECONDS: number = 300;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  SWEEP_BATCH_SIZE: number = 20;

  @ToBoolean()
  @IsBoolean()
  SWEEP_BURN_WHEN_NO_ENERGY: boolean;

  @ToRequiredString()
  @IsString()
  @IsNotEmpty()
  RAPIRA_TRX_RATE_SYMBOL: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  TRX_RATE_TTL_SECONDS: number = 60;

  @ToRequiredNumber()
  @IsInt()
  @Min(1)
  DEPOSIT_WINDOW_MINUTES: number;

  @ToRequiredString()
  @IsCryptoAmount({ positive: true })
  DEPOSIT_MIN_USDT: string;

  @ToRequiredNumber()
  @IsInt()
  @Min(1)
  DEPOSIT_MAX_ACTIVE_REQUESTS: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  DEPOSIT_EXPIRY_INTERVAL_SECONDS: number = 30;

  @ToRequiredString()
  @IsCryptoAmount({ positive: true })
  WITHDRAWAL_MIN_USDT: string;

  @ToRequiredString()
  @IsCryptoAmount({ positive: true })
  WITHDRAWAL_DAILY_LIMIT_USDT: string;

  @ToRequiredNumber()
  @IsInt()
  @Min(0)
  WITHDRAWAL_SECURITY_HOLD_HOURS: number;

  @ToRequiredNumber()
  @IsInt()
  @Min(1)
  WITHDRAWAL_QUOTE_TTL_SECONDS: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  WITHDRAWAL_TOTP_MAX_FAILURES: number = 5;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  WITHDRAWAL_TOTP_LOCK_MINUTES: number = 15;

  @IsIn(PAYOUT_MODES)
  PAYOUT_MODE: (typeof PAYOUT_MODES)[number];

  @Type(() => Number)
  @IsInt()
  @Min(1)
  PAYOUT_INTERVAL_SECONDS: number = 15;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  PAYOUT_BATCH_SIZE: number = 10;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  PAYOUT_STALE_MINUTES: number = 30;
}

export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    exposeDefaultValues: true,
  });

  const errors = validateSync(validated, { skipMissingProperties: false });

  for (const prefix of NIGHT_WINDOW_PREFIXES) {
    const start = `${prefix}_START_HOUR` as const;
    const end = `${prefix}_END_HOUR` as const;
    if (validated[start] === validated[end]) {
      errors.push(
        Object.assign(new ValidationError(), {
          property: start,
          constraints: {
            windowNotEmpty: `${start} and ${end} must differ`,
          },
        }),
      );
    }
  }

  for (const variable of SECURE_URL_VARIABLES) {
    if (variable === 'VAULT_ADDR' && !usesVault(validated)) continue;

    if (
      !isSecureUrl(
        validated[variable],
        validated.NODE_ENV === NodeEnv.Production,
      )
    ) {
      errors.push(
        Object.assign(new ValidationError(), {
          property: variable,
          constraints: {
            secureUrl: `${variable} must be https (plain http only to loopback outside production)`,
          },
        }),
      );
    }
  }

  if (
    validated.TRON_NETWORK === 'mainnet' &&
    validated.TRON_USDT_CONTRACT !== MAINNET_USDT_CONTRACT
  ) {
    errors.push(
      Object.assign(new ValidationError(), {
        property: 'TRON_USDT_CONTRACT',
        constraints: {
          mainnetUsdt: `TRON_USDT_CONTRACT on mainnet must be ${MAINNET_USDT_CONTRACT}`,
        },
      }),
    );
  }

  if (
    usesEnvKeys(validated) &&
    typeof validated.TRON_DEPOSIT_MNEMONIC === 'string' &&
    !utils.ethersUtils.isValidMnemonic(validated.TRON_DEPOSIT_MNEMONIC)
  ) {
    errors.push(
      Object.assign(new ValidationError(), {
        property: 'TRON_DEPOSIT_MNEMONIC',
        constraints: {
          mnemonic: 'TRON_DEPOSIT_MNEMONIC must be a BIP-39 mnemonic',
        },
      }),
    );
  }

  if (usesEnvKeys(validated) && validated.NODE_ENV === NodeEnv.Production) {
    errors.push(
      Object.assign(new ValidationError(), {
        property: 'KEY_SOURCE',
        constraints: {
          notInProduction:
            'KEY_SOURCE=env keeps the keys in plain configuration and is refused in production',
        },
      }),
    );
  }

  if (errors.length > 0) {
    const details = errors
      .map(
        (error) =>
          `  ${error.property}: ${Object.values(error.constraints ?? {}).join(', ')}`,
      )
      .join('\n');

    throw new Error(`Invalid environment variables:\n${details}`);
  }

  return validated;
}
