import { Role } from '../src/common/enums/role.enum';
import { toCrypto } from '../src/common/utils/to-crypto';
import { Device } from '../src/devices/entities/device.entity';
import { MerchantMethod } from '../src/merchants/entities/merchant-method.entity';
import { MerchantsService } from '../src/merchants/services/merchants.service';
import { MethodRate } from '../src/transactions/entities/method-rate.entity';
import { Wallet } from '../src/transactions/entities/wallet.entity';
import { RateScope } from '../src/transactions/types/rate-scope.enum';
import { TraderSettings } from '../src/trader-settings/entities/trader-settings.entity';
import { MerchantApiRequest } from '../src/merchant-requests/entities/merchant-api-request.entity';
import { deviceOf } from './support/device-of';
import { E2eContext, E2eUser, startE2e } from './support/e2e-app';
import { bearer, scan, usdtSun } from './support/flow';
import { EXTERNAL_SENDER } from './support/keys';

describe('MAIN_BALANCE_MIN_THRESHOLD in requisite selection', () => {
  let e2e: E2eContext;
  let admin: E2eUser;
  let merchantId: string;
  let key: string;
  let bankId: number;

  const walletOf = (user: E2eUser) =>
    e2e.dataSource
      .getRepository(Wallet)
      .findOneOrFail({ where: { userId: user.user.id } });
  const summary = async (user: E2eUser) =>
    (await e2e.http.get('/trader/summary').set(bearer(user)).expect(200)).body
      .data;
  const switchTrading = (user: E2eUser, enabled: boolean) =>
    e2e.http.post('/trader/trading').set(bearer(user)).send({ enabled });
  const armRequisite = async (user: E2eUser): Promise<string> => {
    const deviceId = await deviceOf(e2e, user);
    await e2e.dataSource
      .getRepository(Device)
      .update(deviceId, { lastActivity: new Date(Date.now() + 3_600_000) });

    return (
      await e2e.http
        .post('/trader/requisites')
        .set(bearer(user))
        .send({
          type: 'card_or_sbp',
          bankId,
          deviceId,
          phone: '+79010000001',
          cardholderName: 'IVAN IVANOV',
          dailyAmountLimit: '1000000.00',
        })
        .expect(201)
    ).body.data.id as string;
  };
  const createPayIn = (amount = '9090') =>
    e2e.http
      .post('/v1/payment/pay-in')
      .set('X-Secure-Key', key)
      .send({
        method: 'sbp',
        amount,
        merchantTransactionId: `order-${Math.random().toString(36).slice(2)}`,
        payerInfo: { userId: 'client-1', ip: '203.0.113.7' },
      });

  beforeAll(async () => {
    e2e = await startE2e({ MAIN_BALANCE_MIN_THRESHOLD: '100' });
    admin = await e2e.createUser(Role.Admin);
    const superadmin = await e2e.createUser(Role.Superadmin);
    merchantId = (await e2e.app.get(MerchantsService).create('Casino')).id;
    key = (
      await e2e.http
        .post(`/admin/merchants/${merchantId}/keys`)
        .set(bearer(superadmin))
        .expect(201)
    ).body.data.key as string;

    const country = await e2e.http
      .post('/admin/countries')
      .set(bearer(admin))
      .send({ name: 'Россия' })
      .expect(201);
    const currency = await e2e.http
      .post('/admin/currencies')
      .set(bearer(admin))
      .send({ name: 'Рубль', isocode: 'RUB', countryId: country.body.data.id })
      .expect(201);
    bankId = (
      await e2e.http
        .post('/admin/banks')
        .set(bearer(admin))
        .send({
          bankId: 'tbank',
          code: 'tbank',
          name: 'Т-банк',
          countryId: country.body.data.id,
          currencyId: currency.body.data.id,
          transactionTypes: ['card', 'sbp'],
        })
        .expect(201)
    ).body.data.id as number;

    await e2e.dataSource.getRepository(MethodRate).save([
      {
        scope: RateScope.Trader,
        method: 'sbp',
        payInPercent: 7,
        payOutPercent: 0,
      },
      {
        scope: RateScope.Merchant,
        method: 'sbp',
        payInPercent: 10,
        payOutPercent: 0,
      },
    ]);
    await e2e.dataSource.getRepository(MerchantMethod).save({
      merchantId,
      method: 'sbp',
      payInEnabled: true,
      payOutEnabled: false,
    });
    e2e.node.usdt.set(EXTERNAL_SENDER, usdtSun('1000000'));
    await scan(e2e);
  });

  afterAll(() => e2e.close());

  it('drops a trader at or below the threshold, journals the reason, shows it, and leaves the switch on', async () => {
    const trader = await e2e.createUser(Role.Trader);

    await armRequisite(trader);
    await e2e.dataSource.getRepository(Wallet).save({
      userId: trader.user.id,
      mainBalance: toCrypto(100),
      insurancePayInBalance: toCrypto(500),
    });

    expect((await switchTrading(trader, true).expect(409)).body.code).toBe(
      'BALANCE_BELOW_THRESHOLD',
    );
    await e2e.dataSource
      .getRepository(TraderSettings)
      .save({ userId: trader.user.id, tradingEnabled: true });

    const refused = await createPayIn('910').expect(403);
    expect(refused.body.code).toBe('NO_REQUISITE_FOUND_FOR_THIS_AMOUNT');
    await new Promise((resolve) => setTimeout(resolve, 200));
    const logged = await e2e.dataSource
      .getRepository(MerchantApiRequest)
      .findOneOrFail({ where: { id: refused.headers['x-request-id'] } });
    expect(logged.selectionSummary?.dropped).toEqual({
      balance_below_threshold: 1,
    });
    await expect(summary(trader)).resolves.toMatchObject({
      trading: { payIn: true },
      blockers: ['balance_below_threshold'],
    });

    await e2e.dataSource
      .getRepository(Wallet)
      .update(
        { userId: trader.user.id },
        { mainBalance: toCrypto('100.000001') },
      );
    await createPayIn('9.09').expect(201);
    await expect(walletOf(trader)).resolves.toMatchObject({
      mainBalance: toCrypto('100.000001'),
    });
    expect((await summary(trader)).blockers).toEqual([
      'balance_below_threshold',
    ]);
    expect(
      (
        await e2e.dataSource
          .getRepository(TraderSettings)
          .findOneByOrFail({ userId: trader.user.id })
      ).tradingEnabled,
    ).toBe(true);
  });
});
