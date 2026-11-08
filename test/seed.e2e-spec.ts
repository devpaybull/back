import { execFileSync } from 'child_process';
import { generate } from 'otplib';
import { join } from 'path';
import { User } from '../src/users/entities/user.entity';
import { Transaction } from '../src/transactions/entities/transaction.entity';
import { E2eContext, startE2e } from './support/e2e-app';

const SEED_PASSWORD = 'seed-e2e-password';
const SEED_TOTP_SECRET = 'KRSXG5CTMVRXEZLUKRSXG5CTMVRXEZLU';
const SEED_TIMEOUT_MS = 300_000;

describe('scripts/seed.ts on a fresh schema', () => {
  let e2e: E2eContext;
  let firstRun: string;
  let traderToken: string;

  const runSeed = (): string =>
    execFileSync('npx', ['ts-node', join('scripts', 'seed.ts')], {
      cwd: join(__dirname, '..'),
      encoding: 'utf8',
      env: {
        ...process.env,
        DB_SYNCHRONIZE: 'false',
        SEED_PASSWORD,
        SEED_TOTP_SECRET,
      },
    });

  const printed = (label: string): string => {
    const line = firstRun.split('\n').find((row) => row.startsWith(label));
    if (!line) throw new Error(`The seed printed no "${label}"`);

    return line.slice(line.lastIndexOf(' ') + 1);
  };

  const signIn = async (login: string): Promise<string> =>
    (
      await e2e.http
        .post('/auth/login')
        .send({
          login,
          password: SEED_PASSWORD,
          totp: await generate({ secret: SEED_TOTP_SECRET }),
        })
        .expect(200)
    ).body.data.accessToken as string;

  beforeAll(async () => {
    e2e = await startE2e();
  });

  afterAll(() => e2e.close());

  it(
    'seeds once and leaves a second run without changes',
    () => {
      firstRun = runSeed();
      expect(firstRun).toContain('Seed complete');

      const second = runSeed();
      expect(second).toContain('Seed data already present');
    },
    SEED_TIMEOUT_MS,
  );

  it('signs a seeded trader in with SEED_PASSWORD and SEED_TOTP_SECRET', async () => {
    expect(await e2e.dataSource.getRepository(User).count()).toBeGreaterThan(5);
    traderToken = await signIn('trader_one');
  });

  it('serves the seeded merchant on /v1: balance, rate and methods', async () => {
    const key = printed('Merchant API key');

    const balance = await e2e.http
      .get('/v1/merchant/balance')
      .set('X-Secure-Key', key)
      .expect(200);
    expect(balance.body.data.currency).toBe('USDT');

    const rate = await e2e.http
      .get('/v1/payment/rate')
      .set('X-Secure-Key', key)
      .expect(200);
    expect(rate.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ currency: 'RUB', type: 'pay_in' }),
        expect.objectContaining({ currency: 'RUB', type: 'pay_out' }),
      ]),
    );

    const methods = await e2e.http
      .get('/v1/payment/methods')
      .set('X-Secure-Key', key)
      .expect(200);
    expect(JSON.stringify(methods.body.data)).toContain('"sbp"');
  });

  it('takes a pay-in end to end: the paired device beats, a seeded requisite is issued, the trader confirms', async () => {
    await e2e.http
      .post('/device/heartbeat')
      .set('Authorization', `Bearer ${printed('Device token')}`)
      .send({})
      .expect(200);

    const created = await e2e.http
      .post('/v1/payment/pay-in')
      .set('X-Secure-Key', printed('Merchant API key'))
      .send({
        method: 'sbp',
        amount: '2000',
        merchantTransactionId: 'seed-e2e-order-1',
        payerInfo: { userId: 'seed-e2e-client' },
      })
      .expect(201);
    const payment = created.body.data;

    expect(payment).toMatchObject({
      type: 'pay_in',
      method: 'sbp',
      status: 'active',
      amount: '2000.00',
      currency: 'RUB',
      requisite: { type: 'card_or_sbp', sbpNumber: '+79261234567' },
    });

    const deal = await e2e.dataSource.getRepository(Transaction).findOneOrFail({
      where: { id: payment.id },
      relations: { trader: true },
    });
    expect(deal.trader?.telegramUsername).toBe('trader_one');

    await e2e.http
      .post(`/trader/deals/${payment.id}/confirm`)
      .set('Authorization', `Bearer ${traderToken}`)
      .expect(200);

    const read = await e2e.http
      .get(`/v1/payment/${payment.id}`)
      .set('X-Secure-Key', printed('Merchant API key'))
      .expect(200);
    expect(read.body.data.status).toBe('success');
  });

  it('puts the seeded untaken pay-out in the trader’s pool', async () => {
    const pool = await e2e.http
      .get('/trader/payouts/available')
      .set('Authorization', `Bearer ${traderToken}`)
      .expect(200);

    expect(JSON.stringify(pool.body)).toContain('7000.00');
  });
});
