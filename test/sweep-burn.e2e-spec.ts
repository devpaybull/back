import { Role } from '../src/common/enums/role.enum';
import { TronAddress } from '../src/tron/entities/tron-address.entity';
import { E2eContext, E2eUser, startE2e } from './support/e2e-app';
import {
  bearer,
  confirm,
  mainBalance,
  scan,
  sweep,
  usdtSun,
} from './support/flow';
import { EXTERNAL_SENDER, HOT_ADDRESS } from './support/keys';

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

const addressRow = (e2e: E2eContext, address: string) =>
  e2e.dataSource.getRepository(TronAddress).findOneByOrFail({ address });

describe('sweep end to end, burning TRX without a stake', () => {
  let e2e: E2eContext;
  let admin: E2eUser;

  beforeAll(async () => {
    e2e = await startE2e();
    admin = await e2e.createUser(Role.Admin);
    e2e.node.usdt.set(STRANGER, usdtSun('100000'));
    e2e.node.usdt.set(HOT_ADDRESS, usdtSun('1'));
    e2e.node.trx.set(HOT_ADDRESS, 500_000_000n);
    e2e.node.activated.add(HOT_ADDRESS);
    await scan(e2e);
  });

  afterAll(() => e2e.close());

  it('leaves an address below SWEEP_MIN_USDT alone', async () => {
    const trader = await e2e.createUser(Role.Trader);
    await depositTo(e2e, trader, '20');

    await sweep(e2e);

    expect(e2e.node.broadcasts).toHaveLength(0);
  });

  it('activates, funds the fee, sends the whole balance to the hot wallet, signed by the deposit key', async () => {
    const trader = await e2e.createUser(Role.Trader);
    const address = await depositTo(e2e, trader, '100');

    await sweep(e2e);
    expect(last(e2e).raw_data).toEqual(
      expect.objectContaining({
        contract: [
          expect.objectContaining({
            type: 'TransferContract',
            parameter: expect.objectContaining({
              value: expect.objectContaining({
                to_address: address,
                amount: 1,
              }),
            }),
          }),
        ],
      }),
    );
    await settle(e2e);
    expect((await addressRow(e2e, address)).activatedAt).toBeInstanceOf(Date);

    await sweep(e2e);
    const funding = last(e2e);
    expect(
      (
        funding.raw_data as {
          contract: { parameter: { value: { amount: number } } }[];
        }
      ).contract[0].parameter.value.amount,
    ).toBe(13_650_000 - 1);
    await settle(e2e);

    await sweep(e2e);
    const swept = last(e2e);
    expect(
      (
        swept.raw_data as {
          contract: { parameter: { value: { owner_address: string } } }[];
        }
      ).contract[0].parameter.value.owner_address,
    ).toBe(address);
    await settle(e2e);

    expect(e2e.node.usdtOf(address)).toBe(0n);
    expect(e2e.node.usdtOf(HOT_ADDRESS)).toBe(usdtSun('101'));
    const row = await addressRow(e2e, address);
    expect(row.unsweptAmount.toFixed(6)).toBe('0.000000');
    expect(row.lastSweptAt).toBeInstanceOf(Date);
    expect((await mainBalance(e2e, admin, trader.user.id)).mainBalance).toBe(
      '100.000000',
    );

    const before = e2e.node.broadcasts.length;
    await sweep(e2e);
    expect(e2e.node.broadcasts).toHaveLength(before);
  });

  it('never broadcasts the same step twice when a tick repeats before confirmation', async () => {
    const trader = await e2e.createUser(Role.Trader);
    await depositTo(e2e, trader, '60');

    await sweep(e2e);
    const count = e2e.node.broadcasts.length;
    await sweep(e2e);
    await sweep(e2e);

    expect(e2e.node.broadcasts).toHaveLength(count);
  });
});
