import { Role } from '../src/common/enums/role.enum';
import { User } from '../src/users/entities/user.entity';
import { E2eContext, E2eUser, startE2e } from './support/e2e-app';
import { bearer, mainBalance, payout, scan, usdtSun } from './support/flow';
import { EXTERNAL_SENDER, HOT_ADDRESS } from './support/keys';

describe('PAYOUT_MODE=manual end to end', () => {
  let e2e: E2eContext;
  let admin: E2eUser;
  let trader: E2eUser;

  beforeAll(async () => {
    e2e = await startE2e({ PAYOUT_MODE: 'manual' });
    admin = await e2e.createUser(Role.Admin);
    trader = await e2e.createUser(Role.Trader);
    e2e.node.usdt.set(EXTERNAL_SENDER, usdtSun('100000'));
    e2e.node.usdt.set(HOT_ADDRESS, usdtSun('1000'));
    e2e.node.activated.add(HOT_ADDRESS);
    await scan(e2e);
    const address = (
      await e2e.http
        .get('/users/me/deposit-address')
        .set(bearer(trader))
        .expect(200)
    ).body.data.address;
    e2e.node.externalUsdtTransfer(EXTERNAL_SENDER, address, usdtSun('300'));
    await scan(e2e);
  });

  afterAll(() => e2e.close());

  it('never sends a withdrawal itself, and an admin closes a queued one by hash', async () => {
    const destination = 'TKTX96CBxr5kvhjsDHcqoiPWZageGxoTW3';
    await e2e.http
      .get('/users/me/withdrawals/quote')
      .set(bearer(trader))
      .query({ address: destination, amount: '100' })
      .expect(200);
    await e2e.dataSource
      .getRepository(User)
      .update(trader.user.id, { withdrawalTotpLastStep: null });
    const created = await e2e.http
      .post('/users/me/withdrawals')
      .set(bearer(trader))
      .send({
        amount: '100',
        address: destination,
        totp: await e2e.totp(trader),
      })
      .expect(201);

    await payout(e2e);
    expect(e2e.node.broadcasts).toHaveLength(0);

    const list = await e2e.http
      .get('/admin/withdrawals')
      .set(bearer(admin))
      .expect(200);
    expect(list.body.data[0].actions).toEqual({
      canPayManually: true,
      canReject: true,
    });
    const stats = await e2e.http
      .get('/admin/withdrawals/stats')
      .set(bearer(admin))
      .expect(200);
    expect(stats.body.data).toEqual(
      expect.objectContaining({ mode: 'manual', queued: 1 }),
    );

    const hash = e2e.node.externalUsdtTransfer(
      EXTERNAL_SENDER,
      destination,
      usdtSun('100'),
    );
    await e2e.http
      .post(`/admin/withdrawals/${created.body.data.id}/complete-manually`)
      .set(bearer(admin))
      .send({ txHash: hash })
      .expect(200);

    const balances = await mainBalance(e2e, admin, trader.user.id);
    expect(balances.mainReserved).toBe('0.000000');
    expect(Number(balances.mainBalance)).toBeLessThan(200);
  });
});
