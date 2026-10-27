import { TronWeb } from 'tronweb';
import { Role } from '../src/common/enums/role.enum';
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
import {
  EXTERNAL_SENDER,
  HOT_ADDRESS,
  PLAIN_KEYS,
  depositAddressAt,
} from './support/keys';

const DESTINATION = TronWeb.address.fromPrivateKey(
  '0'.repeat(63) + '3',
) as string;

const settle = async (e2e: E2eContext) => {
  e2e.node.mine();
  await confirm(e2e);
};

describe('the Tron engine with KEY_SOURCE=env and no Vault', () => {
  let e2e: E2eContext;
  let admin: E2eUser;
  let trader: E2eUser;

  beforeAll(async () => {
    e2e = await startE2e(PLAIN_KEYS);
    await e2e.vault.stop();
    admin = await e2e.createUser(Role.Admin);
    trader = await e2e.createUser(Role.Trader);
    e2e.node.usdt.set(EXTERNAL_SENDER, usdtSun('100000'));
    e2e.node.trx.set(HOT_ADDRESS, 1_000_000_000n);
    e2e.node.activated.add(HOT_ADDRESS);
    await scan(e2e);
  });

  afterAll(() => e2e.close());

  it('deposits, sweeps and withdraws with the keys from the environment', async () => {
    const address = (
      await e2e.http
        .get('/users/me/deposit-address')
        .set(bearer(trader))
        .expect(200)
    ).body.data.address as string;
    expect(address).toBe(depositAddressAt(0));

    e2e.node.externalUsdtTransfer(EXTERNAL_SENDER, address, usdtSun('100'));
    await scan(e2e);
    expect((await mainBalance(e2e, admin, trader.user.id)).mainBalance).toBe(
      '100.000000',
    );

    for (let step = 0; step < 3; step += 1) {
      await sweep(e2e);
      await settle(e2e);
    }
    expect(e2e.node.usdtOf(address)).toBe(0n);
    expect(e2e.node.usdtOf(HOT_ADDRESS)).toBe(usdtSun('100'));

    await e2e.http
      .get('/users/me/withdrawals/quote')
      .set(bearer(trader))
      .query({ address: DESTINATION, amount: '20' })
      .expect(200);
    await e2e.http
      .post('/users/me/withdrawals')
      .set(bearer(trader))
      .send({
        amount: '20',
        address: DESTINATION,
        totp: await e2e.totp(trader),
      })
      .expect(201);
    await payout(e2e);
    await settle(e2e);

    expect(e2e.node.usdtOf(DESTINATION)).toBe(usdtSun('20'));
    const completed = await e2e.http
      .get('/admin/withdrawals')
      .set(bearer(admin))
      .query({ status: 'completed' })
      .expect(200);
    expect(completed.body.data).toHaveLength(1);
  });
});
