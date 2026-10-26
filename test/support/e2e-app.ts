import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { hash } from 'bcryptjs';
import { execFileSync } from 'child_process';
import cookieParser from 'cookie-parser';
import { generate, generateSecret } from 'otplib';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { Role } from '../../src/common/enums/role.enum';
import { ResponseEnvelopeInterceptor } from '../../src/common/interceptors/response-envelope.interceptor';
import { User } from '../../src/users/entities/user.entity';
import { UserStatus } from '../../src/users/types/user-status.enum';
import { FakeHttpServer } from './fake-http-server';
import { FakeTronNode } from './fake-tron-node';
import { CIPHERTEXTS, PLAINTEXTS } from './keys';
import { readPostgres } from './postgres';

export const PASSWORD = 'correct-horse-battery';
const SECRET = 'an-e2e-secret-that-is-longer-than-32-characters';

export interface E2eUser {
  user: User;
  login: string;
  totpSecret: string;
  token: string;
}

export interface E2eContext {
  app: INestApplication;
  http: ReturnType<typeof request>;
  node: FakeTronNode;
  vault: FakeHttpServer;
  rapira: FakeHttpServer;
  dataSource: DataSource;
  createUser(role: Role, overrides?: Partial<User>): Promise<E2eUser>;
  totp(user: E2eUser, stepOffset?: number): Promise<string>;
  close(): Promise<void>;
}

const resetDatabase = (): void => {
  const { container } = readPostgres();
  execFileSync('docker', [
    'exec',
    container,
    'psql',
    '-U',
    'postgres',
    '-d',
    'paybull_e2e',
    '-c',
    'DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE EXTENSION IF NOT EXISTS "uuid-ossp";',
  ]);
};

export const startE2e = async (
  env: Record<string, string> = {},
): Promise<E2eContext> => {
  resetDatabase();
  const node = new FakeTronNode();
  const vault = new FakeHttpServer((path, body) => {
    if (path === 'v1/auth/approle/login') {
      return body.role_id === 'e2e-role' && body.secret_id === 'e2e-secret'
        ? {
            status: 200,
            body: {
              auth: { client_token: 'vault-token', lease_duration: 3600 },
            },
          }
        : { status: 403, body: {} };
    }

    const plaintext = PLAINTEXTS[String(body.ciphertext)];

    return plaintext
      ? {
          status: 200,
          body: {
            data: { plaintext: Buffer.from(plaintext).toString('base64') },
          },
        }
      : { status: 400, body: { errors: ['bad ciphertext'] } };
  });
  const rapira = new FakeHttpServer(() => ({
    status: 200,
    body: {
      data: [
        { symbol: 'TRX/USDT', close: 0.3 },
        { symbol: 'USDT/RUB', close: 90 },
      ],
    },
  }));
  await Promise.all([node.start(), vault.start(), rapira.start()]);

  Object.assign(process.env, {
    NODE_ENV: 'test',
    DB_HOST: '127.0.0.1',
    DB_PORT: String(readPostgres().port),
    DB_USERNAME: 'postgres',
    DB_PASSWORD: 'e2e',
    DB_NAME: 'paybull_e2e',
    DB_SYNCHRONIZE: 'true',
    DB_LOGGING: 'false',
    JWT_ACCESS_SECRET: SECRET,
    JWT_REFRESH_SECRET: SECRET,
    JWT_REGISTRATION_SECRET: SECRET,
    COUNTERPARTY_MIN_AMOUNT: '5000',
    INSURANCE_PAY_OUT_MIN: '300',
    PLATFORM_MIN_PERCENT: '1',
    DEAL_TTL_MINUTES: '20',
    DEAL_EXPIRY_INTERVAL_SECONDS: '3600',
    DEBT_AUTO_WRITE_OFF_INTERVAL_SECONDS: '3600',
    VICTORIA_LOGS_URL: '',
    MAIL_HOST: '',
    RAPIRA_RATE_URL: rapira.url,
    TRON_NETWORK: 'nile',
    TRON_API_URL: node.url,
    TRON_API_KEY: 'e2e-api-key',
    TRON_USDT_CONTRACT: node.usdtContract,
    VAULT_ADDR: vault.url,
    VAULT_ROLE_ID: 'e2e-role',
    VAULT_SECRET_ID: 'e2e-secret',
    VAULT_TRANSIT_KEY: 'paybull-tron',
    ...CIPHERTEXTS,
    TRON_SCAN_INTERVAL_SECONDS: '3600',
    TRON_CONFIRM_INTERVAL_SECONDS: '3600',
    TRON_MAX_TRX_BURN_PER_TX: '50',
    SWEEP_MIN_USDT: '50',
    SWEEP_INTERVAL_SECONDS: '3600',
    SWEEP_BURN_WHEN_NO_ENERGY: 'true',
    RAPIRA_TRX_RATE_SYMBOL: 'TRX/USDT',
    DEPOSIT_WINDOW_MINUTES: '45',
    DEPOSIT_MIN_USDT: '10',
    DEPOSIT_MAX_ACTIVE_REQUESTS: '2',
    DEPOSIT_EXPIRY_INTERVAL_SECONDS: '3600',
    WITHDRAWAL_MIN_USDT: '5',
    WITHDRAWAL_DAILY_LIMIT_USDT: '1000',
    WITHDRAWAL_SECURITY_HOLD_HOURS: '24',
    WITHDRAWAL_QUOTE_TTL_SECONDS: '60',
    WITHDRAWAL_TOTP_MAX_FAILURES: '5',
    WITHDRAWAL_TOTP_LOCK_MINUTES: '15',
    PAYOUT_MODE: 'auto',
    PAYOUT_INTERVAL_SECONDS: '3600',
    ...env,
  });

  const { AppModule } = await import('../../src/app.module');
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  await app.init();
  const http = request(app.getHttpServer());
  const dataSource = app.get(DataSource);
  let counter = 0;

  const context: E2eContext = {
    app,
    http,
    node,
    vault,
    rapira,
    dataSource,
    async createUser(role, overrides = {}) {
      counter += 1;
      const totpSecret = generateSecret();
      const login = `${role.replace('_', '')}${counter}`;
      const user = await dataSource.getRepository(User).save(
        dataSource.getRepository(User).create({
          telegramUsername: login,
          passwordHash: await hash(PASSWORD, 4),
          role,
          totpSecret,
          twoFactorConfirmedAt: new Date(),
          ...overrides,
          status: UserStatus.Active,
        }),
      );
      const session = await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          login,
          password: PASSWORD,
          totp: await generate({ secret: totpSecret }),
        })
        .expect(200);

      if (overrides.status && overrides.status !== UserStatus.Active) {
        await dataSource
          .getRepository(User)
          .update(user.id, { status: overrides.status });
      }

      return {
        user,
        login,
        totpSecret,
        token: session.body.data.accessToken as string,
      };
    },
    totp(user, stepOffset = 0) {
      return generate({
        secret: user.totpSecret,
        epoch: Math.floor(Date.now() / 1000) + stepOffset * 30,
      });
    },
    async close() {
      await app.close();
      await Promise.all([node.stop(), vault.stop(), rapira.stop()]);
    },
  };

  return context;
};
