import { Role } from '../src/common/enums/role.enum';
import { TronAddress } from '../src/tron/entities/tron-address.entity';
import { E2eContext, E2eUser, startE2e } from './support/e2e-app';
import { bearer, confirm, scan, sweep, usdtSun } from './support/flow';
import { ENERGY_ADDRESS, EXTERNAL_SENDER, HOT_ADDRESS } from './support/keys';

const STRANGER = EXTERNAL_SENDER;

const last = (e2e: E2eContext) =>
  e2e.node.broadcasts[e2e.node.broadcasts.length - 1];

const settle = async (e2e: E2eContext) => {
  e2e.node.mine();
  await confirm(e2e);
};

const depositTo = async (e2e: E2eContext, user: E2eUser, amount: string) => {
  const address = (
    await e2e.http
      .get('/users/me/deposit-address')
      .set(bearer(user))
      .expect(200)
  ).body.data.address as string;
  e2e.node.externalUsdtTransfer(STRANGER, address, usdtSun(amount));
  await scan(e2e);
  return address;
};

describe('sweep end to end, delegating staked energy', () => {
  let e2e: E2eContext;

  beforeAll(async () => {
    e2e = await startE2e({ SWEEP_BURN_WHEN_NO_ENERGY: 'false' });
    e2e.node.usdt.set(STRANGER, usdtSun('100000'));
    e2e.node.usdt.set(HOT_ADDRESS, usdtSun('1'));
    e2e.node.trx.set(HOT_ADDRESS, 500_000_000n);
    e2e.node.activated.add(HOT_ADDRESS);
    e2e.node.activated.add(ENERGY_ADDRESS);
    e2e.node.trx.set(ENERGY_ADDRESS, 10_000_000n);
    await scan(e2e);
  });

  afterAll(() => e2e.close());

  it('waits without a stake when burning is off', async () => {
    const trader = await e2e.createUser(Role.Trader);
    const address = await depositTo(e2e, trader, '80');
    e2e.node.activated.add(address);

    await sweep(e2e);

    expect(e2e.node.broadcasts).toHaveLength(0);
  });

  it('delegates whole TRX of energy, sweeps without burning, then takes the energy back', async () => {
    e2e.node.delegatableSun.set(ENERGY_ADDRESS, 100_000_000_000n);

    await sweep(e2e);
    const delegation = last(e2e);
    const value = (
      delegation.raw_data as {
        contract: { type: string; parameter: { value: { balance: number } } }[];
      }
    ).contract[0];
    expect(value.type).toBe('DelegateResourceContract');
    expect(value.parameter.value.balance).toBe(7_223_000_000);
    await settle(e2e);

    const hotBefore = e2e.node.usdtOf(HOT_ADDRESS);
    await sweep(e2e);
    expect(
      (last(e2e).raw_data as { contract: { type: string }[] }).contract[0].type,
    ).toBe('TriggerSmartContract');
    await settle(e2e);
    expect(e2e.node.usdtOf(HOT_ADDRESS)).toBe(hotBefore + usdtSun('80'));

    await sweep(e2e);
    expect(
      (last(e2e).raw_data as { contract: { type: string }[] }).contract[0].type,
    ).toBe('UnDelegateResourceContract');
    await settle(e2e);

    const rows = await e2e.dataSource.getRepository(TronAddress).find();
    expect(rows.every((row) => row.sweepDelegatedSun === null)).toBe(true);
  });
});
