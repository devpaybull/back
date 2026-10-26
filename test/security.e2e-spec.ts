import { Role } from '../src/common/enums/role.enum';
import { AuditLog } from '../src/audit/entities/audit-log.entity';
import { UserStatus } from '../src/users/types/user-status.enum';
import { E2eContext, E2eUser, startE2e } from './support/e2e-app';
import { bearer, scan, usdtSun } from './support/flow';
import { EXTERNAL_SENDER, HOT_ADDRESS } from './support/keys';

const TRADER_ROUTES: [string, string][] = [
  ['get', '/users/me/deposit-address'],
  ['post', '/users/me/deposits'],
  ['get', '/users/me/deposits/1'],
  ['post', '/users/me/deposits/1/cancel'],
  ['get', '/users/me/withdrawals/quote'],
  ['post', '/users/me/withdrawals'],
  ['get', '/users/me/withdrawals/1'],
  ['post', '/users/me/withdrawals/1/cancel'],
  ['get', '/users/me/finance-operations'],
  ['get', '/users/me/finance-operations/stats'],
];

const ADMIN_ROUTES: [string, string][] = [
  ['get', '/admin/deposits'],
  ['get', '/admin/deposits/stats'],
  ['get', '/admin/deposits/export'],
  ['post', '/admin/deposits/verify-by-hash'],
  ['post', '/admin/deposits/credit-by-hash'],
  ['post', '/admin/deposits/1/verify'],
  ['post', '/admin/deposits/1/credit'],
  ['get', '/admin/withdrawals'],
  ['get', '/admin/withdrawals/stats'],
  ['get', '/admin/withdrawals/export'],
  ['post', '/admin/withdrawals/1/verify'],
  ['post', '/admin/withdrawals/1/complete-manually'],
  ['post', '/admin/withdrawals/1/reject'],
];

describe('security of the money endpoints', () => {
  let e2e: E2eContext;
  let admin: E2eUser;
  let trader: E2eUser;

  const call = (method: string, path: string, user?: E2eUser) => {
    const test = (
      e2e.http as unknown as Record<
        string,
        (path: string) => ReturnType<typeof e2e.http.get>
      >
    )[method](path);
    return user ? test.set(bearer(user)) : test;
  };

  beforeAll(async () => {
    e2e = await startE2e();
    admin = await e2e.createUser(Role.Admin);
    trader = await e2e.createUser(Role.Trader);
    e2e.node.usdt.set(EXTERNAL_SENDER, usdtSun('100000'));
    e2e.node.usdt.set(HOT_ADDRESS, usdtSun('1000'));
    e2e.node.trx.set(HOT_ADDRESS, 1_000_000_000n);
    e2e.node.activated.add(HOT_ADDRESS);
    await scan(e2e);
  });

  afterAll(() => e2e.close());

  it.each([...TRADER_ROUTES, ...ADMIN_ROUTES])(
    'refuses %s %s without a token (401)',
    async (method, path) => {
      await call(method, path).expect(401);
    },
  );

  it.each(ADMIN_ROUTES)(
    'refuses %s %s to a trader (403)',
    async (method, path) => {
      await call(method, path, trader).expect(403);
    },
  );

  it.each(TRADER_ROUTES)(
    'refuses %s %s to an admin and a merchant (403)',
    async (method, path) => {
      const merchant = await e2e.createUser(Role.MerchantSupport);
      await call(method, path, admin).expect(403);
      await call(method, path, merchant).expect(403);
    },
  );

  it('shuts a blocked trader out entirely', async () => {
    const blocked = await e2e.createUser(Role.Trader, {
      status: UserStatus.Blocked,
    });

    await call('get', '/users/me/finance-operations', blocked).expect(401);
  });

  it('lets a suspended trader read the history and nothing that writes', async () => {
    const suspended = await e2e.createUser(Role.Trader, {
      status: UserStatus.Suspended,
    });

    await call('get', '/users/me/finance-operations', suspended).expect(200);
    await call('get', '/users/me/withdrawals/quote', suspended)
      .query({ address: EXTERNAL_SENDER, amount: '10' })
      .expect(403);
    await call('post', '/users/me/withdrawals', suspended)
      .send({ amount: '10', address: EXTERNAL_SENDER, totp: '123456' })
      .expect(403);
  });

  it('refuses unknown fields, a confirmed flag, a JSON number and malformed ids', async () => {
    for (const body of [
      {
        amount: '10',
        address: EXTERNAL_SENDER,
        totp: '123456',
        confirmed: true,
      },
      {
        amount: '10',
        address: EXTERNAL_SENDER,
        totp: '123456',
        userId: admin.user.id,
      },
      { amount: 10, address: EXTERNAL_SENDER, totp: '123456' },
      { amount: '10', address: EXTERNAL_SENDER, totp: '12345' },
    ]) {
      await call('post', '/users/me/withdrawals', trader)
        .send(body)
        .expect(400);
    }

    await call('get', '/users/me/deposits/abc', trader).expect(400);
    await call('post', '/admin/withdrawals/abc/reject', admin)
      .send({ reason: 'x' })
      .expect(400);
    await call('post', '/admin/withdrawals/1/reject', admin)
      .send({ reason: 'x'.repeat(501) })
      .expect(400);
    await call('post', '/admin/deposits/1/credit', admin)
      .send({ txHash: 'zz'.repeat(32) })
      .expect(400);
  });

  it('redacts the TOTP in the http audit trail', async () => {
    await call('post', '/users/me/withdrawals', trader)
      .send({ amount: '10', address: EXTERNAL_SENDER, totp: '654321' })
      .expect(401);
    const rows = await e2e.dataSource.getRepository(AuditLog).find({
      where: { path: '/users/me/withdrawals' },
    });

    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows.map((row) => row.body))).not.toContain('654321');
    expect(
      rows.some(
        (row) => (row.body as { totp?: string })?.totp === '[REDACTED]',
      ),
    ).toBe(true);
  });

  it('answers 503, not a wrong result, when Vault is down', async () => {
    const fresh = await e2e.createUser(Role.Trader);
    await e2e.vault.stop();

    const response = await call(
      'get',
      '/users/me/deposit-address',
      fresh,
    ).expect(503);

    expect(JSON.stringify(response.body)).not.toMatch(/vault|abandon|token/i);
    await e2e.vault.start();
  });
});
