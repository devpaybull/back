import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateIf,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

const MIN_SECRET_LENGTH = 32;
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

  @IsString()
  APP_URL: string = '';

  @IsString()
  @IsNotEmpty()
  TOTP_ISSUER: string = 'Paybull';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  INVITE_TTL_HOURS: number = 72;

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
}

export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    exposeDefaultValues: true,
  });

  const errors = validateSync(validated, { skipMissingProperties: false });

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
