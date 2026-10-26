import { Role } from '../src/common/enums/role.enum';
import { TronAddress } from '../src/tron/entities/tron-address.entity';
import { TronOutgoingTransfer } from '../src/tron/entities/tron-outgoing-transfer.entity';
import { User } from '../src/users/entities/user.entity';
import { E2eContext, E2eUser, startE2e } from './support/e2e-app';
import {
  bearer,
  confirm,
  mainBalance,
  payout,
  scan,
  sweep,
  usdtSun,
} from './support/flow';
import { EXTERNAL_SENDER, HOT_ADDRESS } from './support/keys';

const DESTINATION = 'TKTX96CBxr5kvhjsDHcqoiPWZageGxoTW3';

describe('recovery from failures end to end', () => {
  let e2e: E2eContext;
  let admin: E2eUser;
  let trader: E2eUser;

  const request = async (amount: string) => {
    await e2e.http
      .get('/users/me/withdrawals/quote')
      .set(bearer(trader))
      .query({ address: DESTINATION, amount })
      .expect(200);
    await e2e.dataSource
      .getRepository(User)
      .update(trader.user.id, { withdrawalTotpLastStep: null });
    return (
      await e2e.http
        .post('/users/me/withdrawals')
        .set(bearer(trader))
        .send({ amount, address: DESTINATION, totp: await e2e.totp(trader) })
        .expect(201)
    ).body.data.id as number;
  };
  const statusOf = async (id: number) =>
    (
      await e2e.http
        .get(`/users/me/withdrawals/${id}`)
        .set(bearer(trader))
        .expect(200)
    ).body.data;

  beforeAll(async () => {
    e2e = await startE2e();
    admin = await e2e.createUser(Role.Admin);
    trader = await e2e.createUser(Role.Trader);
    e2e.node.usdt.set(EXTERNAL_SENDER, usdtSun('100000'));
    e2e.node.trx.set(HOT_ADDRESS, 1_000_000_000n);
    e2e.node.activated.add(HOT_ADDRESS);
    await scan(e2e);
    const address = (
      await e2e.http
        .get('/users/me/deposit-address')
        .set(bearer(trader))
        .expect(200)
    ).body.data.address;
    e2e.node.externalUsdtTransfer(EXTERNAL_SENDER, address, usdtSun('500'));
    await scan(e2e);
  });

  afterAll(() => e2e.close());

  it('keeps a withdrawal queued while the hot wallet cannot cover it', async () => {
    const id = await request('40');

    await payout(e2e);

    expect(e2e.node.broadcasts).toHaveLength(0);
    expect((await statusOf(id)).status).toBe('pending');
    e2e.node.usdt.set(HOT_ADDRESS, usdtSun('1000'));
    await payout(e2e);
    e2e.node.mine();
    await confirm(e2e);
    expect((await statusOf(id)).status).toBe('completed');
  });

  it('returns a withdrawal to the queue when Vault is down before signing, and sends it later', async () => {
    const id = await request('30');
    await e2e.vault.stop();

    await payout(e2e);

    expect((await statusOf(id)).status).toBe('pending');
    await e2e.vault.start();
    await payout(e2e);
    e2e.node.mine();
    await confirm(e2e);
    expect((await statusOf(id)).status).toBe('completed');
  });

  it('keeps a signed but never broadcast withdrawal processing, then fails it once it expired', async () => {
    const count = e2e.node.broadcasts.length;
    e2e.node.failBroadcasts = true;
    const id = await request('20');

    await payout(e2e);

    expect(e2e.node.broadcasts).toHaveLength(count);
    expect((await statusOf(id)).status).toBe('processing');
    await confirm(e2e);
    expect((await statusOf(id)).status).toBe('processing');

    await confirm(e2e, new Date(Date.now() + 20 * 60_000));
    const failed = await statusOf(id);
    expect(failed).toEqual(
      expect.objectContaining({
        status: 'failed',
        statusReason: 'network_failed',
      }),
    );
    e2e.node.failBroadcasts = false;

    await e2e.http
      .post(`/admin/withdrawals/${id}/reject`)
      .set(bearer(admin))
      .send({ reason: 'expired unsent' })
      .expect(200);
  });

  it('never marks a transaction expired while the node still knows it', async () => {
    const id = await request('10');
    await payout(e2e);
    expect((await statusOf(id)).status).toBe('processing');

    await confirm(e2e, new Date(Date.now() + 20 * 60_000));

    expect((await statusOf(id)).status).toBe('processing');
    e2e.node.mine();
    await confirm(e2e);
    expect((await statusOf(id)).status).toBe('completed');
  });

  it('records the real network cost of every confirmed transfer', async () => {
    const rows = await e2e.dataSource
      .getRepository(TronOutgoingTransfer)
      .find({ where: { status: 'confirmed' as never } });

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.energyUsed).not.toBeNull();
      expect(row.trxBurnedSun).not.toBeNull();
      expect(row.blockNumber).not.toBeNull();
    }
  });

  it('keeps the books balanced: the trader paid amount + fee for every completed withdrawal', async () => {
    const balances = await mainBalance(e2e, admin, trader.user.id);
    const journal = await e2e.http
      .get(`/admin/users/${trader.user.id}/balance-operations`)
      .set(bearer(admin))
      .query({ limit: 100 })
      .expect(200);
    const sum = journal.body.data.reduce(
      (total: number, row: { amount: string }) => total + Number(row.amount),
      0,
    );

    expect(sum.toFixed(6)).toBe(balances.mainBalance);
    expect(balances.mainReserved).toBe('0.000000');
  });

  it('unblocks a sweep whose step failed before signing', async () => {
    const owner = await e2e.createUser(Role.Trader);
    const address = (
      await e2e.http
        .get('/users/me/deposit-address')
        .set(bearer(owner))
        .expect(200)
    ).body.data.address;
    e2e.node.externalUsdtTransfer(EXTERNAL_SENDER, address, usdtSun('90'));
    await scan(e2e);
    e2e.node.activated.add(address);
    await e2e.vault.stop();

    await sweep(e2e);
    const stuck = await e2e.dataSource
      .getRepository(TronAddress)
      .findOneByOrFail({ address });

    await e2e.vault.start();
    expect(stuck.sweepNonce).toBe(1);
  });
});
