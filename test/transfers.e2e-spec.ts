import { Role } from '../src/common/enums/role.enum';
import { E2eContext, E2eUser, startE2e } from './support/e2e-app';
import { bearer, mainBalance, scan, usdtSun } from './support/flow';
import { EXTERNAL_SENDER } from './support/keys';

describe('admin transfer between accounts (AT01)', () => {
  let e2e: E2eContext;
  let admin: E2eUser;

  beforeAll(async () => {
    e2e = await startE2e();
    admin = await e2e.createUser(Role.Superadmin);
  });

  afterAll(() => e2e.close());

  it('moves the money in one row, with both journal legs, to a recipient without a wallet', async () => {
    const sender = await e2e.createUser(Role.Trader);
    const recipient = await e2e.createUser(Role.LeadTrader);
    const address = (
      await e2e.http
        .get('/users/me/deposit-address')
        .set(bearer(sender))
        .expect(200)
    ).body.data.address;
    e2e.node.usdt.set(EXTERNAL_SENDER, usdtSun('1000'));
    await scan(e2e);
    e2e.node.externalUsdtTransfer(EXTERNAL_SENDER, address, usdtSun('200'));
    await scan(e2e);

    const moved = await e2e.http
      .post(`/admin/users/${sender.user.id}/transfer`)
      .set(bearer(admin))
      .send({ recipient: recipient.login, amount: '75.5', comment: 'share' })
      .expect(201);

    expect(moved.body.data).toEqual(
      expect.objectContaining({
        type: 'transfer',
        status: 'completed',
        userId: sender.user.id,
        counterpartyUserId: recipient.user.id,
        amount: '75.500000',
        comment: 'share',
        actorUserId: admin.user.id,
      }),
    );
    expect((await mainBalance(e2e, admin, sender.user.id)).mainBalance).toBe(
      '124.500000',
    );
    expect((await mainBalance(e2e, admin, recipient.user.id)).mainBalance).toBe(
      '75.500000',
    );

    const legs = await e2e.http
      .get(`/admin/users/${recipient.user.id}/balance-operations`)
      .set(bearer(admin))
      .expect(200);
    expect(legs.body.data[0].reference).toEqual({
      transactionId: null,
      debtId: null,
      accountTransactionId: moved.body.data.id,
    });

    await e2e.http
      .post(`/admin/users/${sender.user.id}/transfer`)
      .set(bearer(admin))
      .send({ recipient: recipient.login, amount: '1000' })
      .expect(409);
    expect((await mainBalance(e2e, admin, sender.user.id)).mainBalance).toBe(
      '124.500000',
    );
  });
});
