import { Role } from '../src/common/enums/role.enum';
import { toCrypto } from '../src/common/utils/to-crypto';
import { toFiat } from '../src/common/utils/to-fiat';
import { toRate } from '../src/common/utils/to-rate';
import { MerchantsService } from '../src/merchants/services/merchants.service';
import { Wallet } from '../src/transactions/entities/wallet.entity';
import { TransactionService } from '../src/transactions/services/transaction.service';
import { TransactionKind } from '../src/transactions/types/transaction-kind.enum';
import { User } from '../src/users/entities/user.entity';
import { E2eContext, E2eUser, startE2e } from './support/e2e-app';
import { bearer, payout, usdtSun } from './support/flow';
import { EXTERNAL_SENDER, HOT_ADDRESS } from './support/keys';

const DESTINATION = 'TKTX96CBxr5kvhjsDHcqoiPWZageGxoTW3';

describe('the merchant cabinet', () => {
  let e2e: E2eContext;
  let admin: E2eUser;
  let trader: E2eUser;
  let merchant: E2eUser;
  let support: E2eUser;
  let stranger: E2eUser;
  let own: string;
  let other: string;
  let ownDeal: string;
  let otherDeal: string;

  const succeed = (id: string) =>
    e2e.http
      .patch(`/admin/transactions/${id}/status`)
      .set(bearer(admin))
      .send({ status: 'success' })
      .expect(200);

  const freshTotp = async (user: E2eUser) => {
    await e2e.dataSource
      .getRepository(User)
      .update(user.user.id, { withdrawalTotpLastStep: null });

    return e2e.totp(user);
  };

  beforeAll(async () => {
    e2e = await startE2e();
    admin = await e2e.createUser(Role.Admin);
    trader = await e2e.createUser(Role.Trader);

    const merchants = e2e.app.get(MerchantsService);
    own = (await merchants.create('Casino')).id;
    other = (await merchants.create('Other')).id;
    merchant = await e2e.createUser(Role.Merchant, { merchantId: own });
    support = await e2e.createUser(Role.MerchantSupport, { merchantId: own });
    stranger = await e2e.createUser(Role.Merchant, { merchantId: other });

    e2e.node.usdt.set(EXTERNAL_SENDER, usdtSun('100000'));
    e2e.node.usdt.set(HOT_ADDRESS, usdtSun('1000'));
    e2e.node.activated.add(HOT_ADDRESS);

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
    const bank = await e2e.http
      .post('/admin/banks')
      .set(bearer(admin))
      .send({
        bankId: 'tbank',
        name: 'Т-банк',
        countryId: country.body.data.id,
        currencyId: currency.body.data.id,
        transactionTypes: ['card', 'sbp'],
      })
      .expect(201);
    const bankDetailsId = (
      await e2e.http
        .post('/bank-details')
        .set(bearer(trader))
        .send({ bankId: bank.body.data.id, type: 'sbp', phone: '+79012345678' })
        .expect(201)
    ).body.data.id;
    await e2e.dataSource
      .getRepository(Wallet)
      .save({ userId: trader.user.id, mainBalance: toCrypto(5000) });

    const deals = e2e.app.get(TransactionService);
    const payIn = (merchantId: string) =>
      deals.createDeal({
        kind: TransactionKind.PayIn,
        method: 'sbp',
        traderUserId: trader.user.id,
        bankDetailsId,
        merchantId,
        amountFiat: toFiat(9000),
        rate: toRate(90),
        merchantPercent: 10,
        traderPercent: 7,
      });
    ownDeal = (await payIn(own)).id;
    otherDeal = (await payIn(other)).id;
    await succeed(ownDeal);
  });

  afterAll(() => e2e.close());

  it('is closed to a trader and to a merchant-side account bound to no merchant', async () => {
    await e2e.http.get('/merchant/me').set(bearer(trader)).expect(403);
    const unbound = await e2e.createUser(Role.MerchantAgent);
    await e2e.http.get('/merchant/me').set(bearer(unbound)).expect(403);
    await e2e.http.get('/merchant/me').expect(401);
  });

  it('shows the merchant its header, its deals and none of another merchant’s', async () => {
    const me = await e2e.http
      .get('/merchant/me')
      .set(bearer(support))
      .expect(200);
    expect(me.body.data.merchant).toEqual({ id: own, name: 'Casino' });
    expect(Number(me.body.data.balance.available)).toBeGreaterThan(0);

    const list = await e2e.http
      .get('/merchant/deals')
      .set(bearer(merchant))
      .query({ search: ownDeal.slice(0, 8) })
      .expect(200);
    expect(list.body.meta.total).toBe(1);
    expect(list.body.data[0]).toMatchObject({
      id: ownDeal,
      status: 'success',
      amountFiat: '9000.00',
      currency: 'RUB',
      requisite: { bank: { name: 'Т-банк' }, phone: '+79012345678' },
    });
    expect(list.body.data[0]).not.toHaveProperty('trader');

    await e2e.http
      .get(`/merchant/deals/${otherDeal}`)
      .set(bearer(merchant))
      .expect(404);
    const detail = await e2e.http
      .get(`/merchant/deals/${ownDeal}`)
      .set(bearer(merchant))
      .expect(200);
    expect(
      detail.body.data.statusHistory.map(
        (event: { toStatus: string }) => event.toStatus,
      ),
    ).toEqual(['active', 'success']);

    const counters = await e2e.http
      .get('/merchant/deals/counters')
      .set(bearer(merchant))
      .expect(200);
    expect(counters.body.data.tabs).toMatchObject({ all: 1, success: 1 });

    const csv = await e2e.http
      .get('/merchant/deals/export')
      .set(bearer(merchant))
      .expect(200);
    expect(csv.text.split('\r\n')[1]).toContain(ownDeal);
  });

  it('answers the dashboard, the 30-day series and the balance journal from Postgres', async () => {
    const dashboard = await e2e.http
      .get('/merchant/dashboard')
      .set(bearer(merchant))
      .expect(200);
    expect(dashboard.body.data.payIns.successfulCount).toBe(1);
    expect(dashboard.body.data.results.turnover).toBe('100.000000');
    expect(dashboard.body.data.period.from).toBeNull();

    const series = await e2e.http
      .get('/merchant/dashboard/turnover-series')
      .set(bearer(merchant))
      .expect(200);
    expect(series.body.data).toHaveLength(30);
    expect(series.body.data[29].amount).toBe('100.000000');

    const journal = await e2e.http
      .get('/merchant/balance-operations')
      .set(bearer(merchant))
      .query({ search: ownDeal.slice(-6) })
      .expect(200);
    expect(journal.body.data).toHaveLength(1);
    expect(journal.body.data[0].type).toBe('deal_pay_in');
  });

  it('lets only the merchant account change the links, and records it in its feed', async () => {
    await e2e.http
      .patch('/merchant/settings')
      .set(bearer(support))
      .send({ callbackUrl: 'https://shop.example/cb' })
      .expect(403);
    const saved = await e2e.http
      .patch('/merchant/settings')
      .set(bearer(merchant))
      .send({ callbackUrl: 'https://shop.example/cb' })
      .expect(200);
    expect(saved.body.data.callbackUrl).toBe('https://shop.example/cb');
    await e2e.http
      .patch('/merchant/settings')
      .set(bearer(merchant))
      .send({ payoutOverdraftEnabled: true })
      .expect(400);

    const feed = await e2e.http
      .get('/merchant/activity')
      .set(bearer(merchant))
      .expect(200);
    expect(feed.body.data[0].action).toBe('merchant_activity.links_updated');
  });

  it('holds a withdrawal request, keeps it out of the queue, and settles it when an admin pays by hand', async () => {
    await e2e.http
      .get('/merchant/withdrawals/quote')
      .set(bearer(merchant))
      .query({ address: DESTINATION, amount: '20' })
      .expect(200);
    await e2e.http
      .post('/merchant/withdrawals')
      .set(bearer(support))
      .send({ amount: '20', address: DESTINATION, totp: '000000' })
      .expect(403);
    const created = await e2e.http
      .post('/merchant/withdrawals')
      .set(bearer(merchant))
      .send({
        amount: '20',
        address: DESTINATION,
        totp: await freshTotp(merchant),
      })
      .expect(201);
    const id = created.body.data.id;

    const held = await e2e.http
      .get('/merchant/me')
      .set(bearer(merchant))
      .expect(200);
    expect(Number(held.body.data.balance.withdrawalReserved)).toBeGreaterThan(
      20,
    );

    await payout(e2e);
    expect(e2e.node.broadcasts).toHaveLength(0);

    const adminList = await e2e.http
      .get('/admin/withdrawals')
      .set(bearer(admin))
      .query({ merchantId: own })
      .expect(200);
    expect(adminList.body.data[0]).toMatchObject({
      id,
      merchant: { id: own, name: 'Casino' },
      actions: { canPayManually: true, canReject: true },
    });

    await e2e.http
      .get(`/merchant/withdrawals/${id}`)
      .set(bearer(stranger))
      .expect(404);

    const hash = e2e.node.externalUsdtTransfer(
      EXTERNAL_SENDER,
      DESTINATION,
      usdtSun('20'),
    );
    await e2e.http
      .post(`/admin/withdrawals/${id}/complete-manually`)
      .set(bearer(admin))
      .send({ txHash: hash })
      .expect(200);

    const after = await e2e.http
      .get('/merchant/me')
      .set(bearer(merchant))
      .expect(200);
    expect(after.body.data.balance.withdrawalReserved).toBe('0.000000');
    const mine = await e2e.http
      .get('/merchant/withdrawals')
      .set(bearer(merchant))
      .expect(200);
    expect(mine.body.data[0]).toMatchObject({
      id,
      status: 'completed',
      txHash: hash,
    });
    const journal = await e2e.http
      .get('/merchant/balance-operations')
      .set(bearer(merchant))
      .query({ type: 'withdrawal_hold,withdrawal' })
      .expect(200);
    expect(journal.body.data.map((row: { type: string }) => row.type)).toEqual([
      'withdrawal',
      'withdrawal_hold',
    ]);
    const feed = await e2e.http
      .get('/merchant/activity')
      .set(bearer(merchant))
      .expect(200);
    expect(feed.body.data[0].action).toBe(
      'merchant_activity.withdrawal_completed',
    );
  });

  it('returns the hold of a request the merchant cancels', async () => {
    const before = (
      await e2e.http.get('/merchant/me').set(bearer(merchant)).expect(200)
    ).body.data.balance.available;
    await e2e.http
      .get('/merchant/withdrawals/quote')
      .set(bearer(merchant))
      .query({ address: DESTINATION, amount: '10' })
      .expect(200);
    const created = await e2e.http
      .post('/merchant/withdrawals')
      .set(bearer(merchant))
      .send({
        amount: '10',
        address: DESTINATION,
        totp: await freshTotp(merchant),
      })
      .expect(201);

    await e2e.http
      .post(`/merchant/withdrawals/${created.body.data.id}/cancel`)
      .set(bearer(merchant))
      .expect(200);

    const after = (
      await e2e.http.get('/merchant/me').set(bearer(merchant)).expect(200)
    ).body.data.balance;
    expect(after.available).toBe(before);
    expect(after.withdrawalReserved).toBe('0.000000');
  });
});
