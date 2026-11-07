import { AuditLog } from '../src/audit/entities/audit-log.entity';
import { BankDetails } from '../src/bank-details/entities/bank-details.entity';
import { Role } from '../src/common/enums/role.enum';
import { toCrypto } from '../src/common/utils/to-crypto';
import { Device } from '../src/devices/entities/device.entity';
import { MerchantMethod } from '../src/merchants/entities/merchant-method.entity';
import { MerchantsService } from '../src/merchants/services/merchants.service';
import { TraderSettings } from '../src/trader-settings/entities/trader-settings.entity';
import { MerchantBalance } from '../src/transactions/entities/merchant-balance.entity';
import { MethodRate } from '../src/transactions/entities/method-rate.entity';
import { TransactionLeadShare } from '../src/transactions/entities/transaction-lead-share.entity';
import { TransactionStatusEvent } from '../src/transactions/entities/transaction-status-event.entity';
import { Transaction } from '../src/transactions/entities/transaction.entity';
import { Wallet } from '../src/transactions/entities/wallet.entity';
import { RateScope } from '../src/transactions/types/rate-scope.enum';
import { UserStatus } from '../src/users/types/user-status.enum';
import { User } from '../src/users/entities/user.entity';
import { deviceOf } from './support/device-of';
import { E2eContext, E2eUser, startE2e } from './support/e2e-app';
import { bearer } from './support/flow';

describe('the trader cabinet: deals', () => {
  let e2e: E2eContext;
  let trader: E2eUser;
  let stranger: E2eUser;
  let merchantId: string;
  let key: string;
  let requisiteId: string;

  const startingMain = toCrypto(100000);

  const createPayIn = async (amount: string): Promise<string> =>
    (
      await e2e.http
        .post('/v1/payment/pay-in')
        .set('X-Secure-Key', key)
        .send({
          method: 'sbp',
          amount,
          merchantTransactionId: `order-${Math.random().toString(36).slice(2)}`,
          payerInfo: { userId: 'client-1', ip: '203.0.113.7' },
        })
        .expect(201)
    ).body.data.id as string;

  const dealRow = (id: string) =>
    e2e.dataSource.getRepository(Transaction).findOneOrFail({ where: { id } });
  const wallet = () =>
    e2e.dataSource
      .getRepository(Wallet)
      .findOneOrFail({ where: { userId: trader.user.id } });
  const merchantBalance = () =>
    e2e.dataSource
      .getRepository(MerchantBalance)
      .findOne({ where: { merchantId } });
  const auditOf = (action: string) =>
    e2e.dataSource.getRepository(AuditLog).find({ where: { action } });
  const post = (id: string, action: string, as: E2eUser = trader) =>
    e2e.http.post(`/trader/deals/${id}/${action}`).set(bearer(as));

  beforeAll(async () => {
    e2e = await startE2e();
    const superadmin = await e2e.createUser(Role.Superadmin);
    const admin = await e2e.createUser(Role.Admin);
    const merchants = e2e.app.get(MerchantsService);

    merchantId = (await merchants.create('Casino')).id;
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
    const bankId = (
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

    trader = await e2e.createUser(Role.Trader);
    stranger = await e2e.createUser(Role.Trader);
    const deviceId = await deviceOf(e2e, trader);
    await e2e.dataSource
      .getRepository(Device)
      .update(deviceId, { lastActivity: new Date(Date.now() + 3_600_000) });
    await e2e.dataSource
      .getRepository(TraderSettings)
      .save({ userId: trader.user.id, tradingEnabled: true });
    await e2e.dataSource.getRepository(Wallet).save({
      userId: trader.user.id,
      mainBalance: startingMain,
      insurancePayInBalance: toCrypto(1000),
    });
    requisiteId = (
      await e2e.http
        .post('/bank-details')
        .set(bearer(trader))
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
  });

  afterAll(() => e2e.close());

  it('lists a pay-in from /v1 for its trader today, and shows it to nobody else', async () => {
    const id = await createPayIn('1010');

    const listed = await e2e.http
      .get('/trader/deals')
      .set(bearer(trader))
      .query({ status: 'active' })
      .expect(200);
    const row = (listed.body.data as { id: string }[]).find(
      (deal) => deal.id === id,
    );

    expect(row).toEqual(
      expect.objectContaining({
        status: 'active',
        amountFiat: '1010.00',
        method: 'sbp',
        merchantGroup: null,
      }),
    );
    expect(JSON.stringify(listed.body)).not.toContain('Casino');
    expect(JSON.stringify(row)).not.toContain(merchantId);

    await e2e.http.get(`/trader/deals/${id}`).set(bearer(stranger)).expect(404);
    await post(id, 'confirm', stranger).expect(404);

    const foreign = await e2e.http
      .get('/trader/deals')
      .set(bearer(stranger))
      .expect(200);
    expect(foreign.body.data).toEqual([]);

    const counters = await e2e.http
      .get('/trader/deals/counters')
      .set(bearer(trader))
      .query({ status: 'canceled' })
      .expect(200);
    expect(counters.body.data.active).toBeGreaterThanOrEqual(1);

    const byPiece = await e2e.http
      .get('/trader/deals')
      .set(bearer(trader))
      .query({ search: id.slice(9, 18), counterparty: 'client-1' })
      .expect(200);
    expect((byPiece.body.data as { id: string }[]).map((d) => d.id)).toEqual([
      id,
    ]);
    const noClient = await e2e.http
      .get('/trader/deals')
      .set(bearer(trader))
      .query({ counterparty: 'nobody' })
      .expect(200);
    expect(noClient.body.data).toEqual([]);

    const csv = await e2e.http
      .get('/trader/deals/export')
      .set(bearer(trader))
      .query({ search: id })
      .expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain(id);

    await post(id, 'decline').send({ reasonCode: 'limit_reached' }).expect(200);
  });

  it('is closed to any other role and to a suspended trader', async () => {
    const id = await createPayIn('1020');
    const admin = await e2e.createUser(Role.Admin);

    await e2e.http.get('/trader/deals').set(bearer(admin)).expect(403);
    await post(id, 'confirm', admin).expect(403);

    const suspended = await e2e.createUser(Role.Trader);
    await e2e.dataSource
      .getRepository(User)
      .update(suspended.user.id, { status: UserStatus.Suspended });
    await e2e.http
      .post(`/trader/deals/${id}/confirm`)
      .set(bearer(suspended))
      .expect(403);

    await post(id, 'decline')
      .send({ reasonCode: 'device_offline' })
      .expect(200);
  });

  it('confirm: success, the trader pays, the merchant is credited, the event names the trader; a repeat moves nothing', async () => {
    const id = await createPayIn('1030');
    const before = await wallet();
    const balanceBefore = await merchantBalance();
    const created = await dealRow(id);

    const answer = await post(id, 'confirm').expect(200);

    expect(answer.body.data).toEqual(
      expect.objectContaining({ status: 'success', traderEffectivePercent: 7 }),
    );

    const after = await wallet();
    expect(after.mainBalance.toFixed(6)).toBe(
      before.mainBalance.minus(created.traderAmount).toFixed(6),
    );
    expect(after.mainReserved.toFixed(6)).toBe(
      before.mainReserved.minus(created.traderAmount).toFixed(6),
    );
    const credited = await merchantBalance();
    expect(credited?.balance.toFixed(6)).toBe(
      (balanceBefore?.balance ?? toCrypto(0))
        .plus(created.merchantAmount)
        .toFixed(6),
    );

    const event = await e2e.dataSource
      .getRepository(TransactionStatusEvent)
      .findOneOrFail({
        where: { transactionId: id, toStatus: answer.body.data.status },
      });
    expect(event.source).toBe('trader');
    expect(event.actorUserId).toBe(trader.user.id);

    await post(id, 'confirm').expect(200);
    expect((await wallet()).mainBalance.toFixed(6)).toBe(
      after.mainBalance.toFixed(6),
    );
    expect(
      (await auditOf('trader.deal_confirmed')).filter(
        (row) => row.metadata?.transactionId === id,
      ),
    ).toHaveLength(1);

    await post(id, 'decline').send({ reasonCode: 'limit_reached' }).expect(409);
  });

  it('confirm-changed with less: the surplus escrow returns, every figure follows, the original is kept', async () => {
    const id = await createPayIn('2000');
    const created = await dealRow(id);
    const before = await wallet();
    const balanceBefore = await merchantBalance();

    const answer = await post(id, 'confirm-changed')
      .send({ amount: '1500.50' })
      .expect(200);

    expect(answer.body.data).toEqual(
      expect.objectContaining({
        status: 'success_changed',
        amountFiat: '1500.50',
        originalAmountFiat: '2000.00',
      }),
    );

    const settled = await dealRow(id);
    const after = await wallet();

    expect(settled.traderAmount.lt(created.traderAmount)).toBe(true);
    expect(settled.originalTraderAmount?.toFixed(6)).toBe(
      created.traderAmount.toFixed(6),
    );
    expect(settled.originalMerchantAmount?.toFixed(6)).toBe(
      created.merchantAmount.toFixed(6),
    );
    expect(after.mainBalance.toFixed(6)).toBe(
      before.mainBalance.minus(settled.traderAmount).toFixed(6),
    );
    expect(after.mainReserved.toFixed(6)).toBe(
      before.mainReserved.minus(created.traderAmount).toFixed(6),
    );
    const credited = await merchantBalance();
    expect(credited?.balance.toFixed(6)).toBe(
      (balanceBefore?.balance ?? toCrypto(0))
        .plus(settled.merchantAmount)
        .toFixed(6),
    );

    await post(id, 'confirm-changed').send({ amount: '1500.50' }).expect(200);
    await post(id, 'confirm-changed').send({ amount: '1600' }).expect(409);
    await post(id, 'confirm').expect(409);
  });

  it('confirm-changed with more: reserves the difference, or a 409 that changes nothing', async () => {
    const id = await createPayIn('3000');
    const created = await dealRow(id);
    const before = await wallet();

    await e2e.dataSource
      .getRepository(Wallet)
      .update({ userId: trader.user.id }, { mainBalance: before.mainReserved });

    const refused = await post(id, 'confirm-changed')
      .send({ amount: '4000' })
      .expect(409);

    expect(refused.body.code).toBe('INSUFFICIENT_BALANCE');
    expect((await dealRow(id)).status).toBe('active');
    expect((await dealRow(id)).originalAmountFiat).toBeNull();
    expect((await wallet()).mainReserved.toFixed(6)).toBe(
      before.mainReserved.toFixed(6),
    );

    await e2e.dataSource
      .getRepository(Wallet)
      .update({ userId: trader.user.id }, { mainBalance: before.mainBalance });

    await post(id, 'confirm-changed').send({ amount: '4000' }).expect(200);

    const settled = await dealRow(id);
    const after = await wallet();

    expect(settled.traderAmount.gt(created.traderAmount)).toBe(true);
    expect(after.mainBalance.toFixed(6)).toBe(
      before.mainBalance.minus(settled.traderAmount).toFixed(6),
    );
    expect(after.mainReserved.toFixed(6)).toBe(
      before.mainReserved.minus(created.traderAmount).toFixed(6),
    );
  });

  it('confirm-changed upward pays the merchant and the leads from the new figures; a zero-share lead with no wallet does not get in the way', async () => {
    const id = await createPayIn('3050');
    const created = await dealRow(id);
    const paidLead = await e2e.createUser(Role.Trader);
    const zeroLead = await e2e.createUser(Role.Trader);

    await e2e.dataSource.getRepository(TransactionLeadShare).save([
      {
        transactionId: id,
        leadUserId: paidLead.user.id,
        percent: 1,
        amount: toCrypto(created.amountCrypto.times(0.01).toFixed(6)),
      },
      {
        transactionId: id,
        leadUserId: zeroLead.user.id,
        percent: 0,
        amount: toCrypto(0),
      },
    ]);
    const balanceBefore = await merchantBalance();

    await post(id, 'confirm-changed').send({ amount: '4050' }).expect(200);

    const settled = await dealRow(id);
    const leadWallet = await e2e.dataSource
      .getRepository(Wallet)
      .findOneOrFail({ where: { userId: paidLead.user.id } });
    const credited = await merchantBalance();

    expect(settled.merchantAmount.gt(created.merchantAmount)).toBe(true);
    expect(credited?.balance.toFixed(6)).toBe(
      (balanceBefore?.balance ?? toCrypto(0))
        .plus(settled.merchantAmount)
        .toFixed(6),
    );
    expect(leadWallet.mainBalance.toFixed(6)).toBe(
      settled.amountCrypto.times(0.01).toDecimalPlaces(6).toFixed(6),
    );
    expect(settled.leadCommission?.toFixed(6)).toBe(
      leadWallet.mainBalance.toFixed(6),
    );
    expect(
      await e2e.dataSource
        .getRepository(Wallet)
        .findOne({ where: { userId: zeroLead.user.id } }),
    ).toBeNull();
  });

  it('an admin cannot reach success_changed from active: that edge is the trader’s', async () => {
    const id = await createPayIn('3100');
    const superadmin = await e2e.createUser(Role.Superadmin);

    await e2e.http
      .patch(`/admin/transactions/${id}/status`)
      .set(bearer(superadmin))
      .send({ status: 'success_changed', reason: 'try' })
      .expect(409);

    await post(id, 'decline').send({ reasonCode: 'limit_reached' }).expect(200);
  });

  it('decline: canceled with its reason, escrow released; requisite_blocked also switches the requisite off', async () => {
    const id = await createPayIn('3200');
    const before = await wallet();
    const created = await dealRow(id);

    await post(id, 'decline').send({ reasonCode: 'other' }).expect(400);

    const answer = await post(id, 'decline')
      .send({ reasonCode: 'requisite_blocked' })
      .expect(200);

    expect(answer.body.data).toEqual(
      expect.objectContaining({
        status: 'canceled',
        declineReasonCode: 'requisite_blocked',
      }),
    );

    const after = await wallet();
    expect(after.mainBalance.toFixed(6)).toBe(before.mainBalance.toFixed(6));
    expect(after.mainReserved.toFixed(6)).toBe(
      before.mainReserved.minus(created.traderAmount).toFixed(6),
    );

    const requisite = await e2e.dataSource
      .getRepository(BankDetails)
      .findOneOrFail({ where: { id: requisiteId } });
    expect(requisite.active).toBe(false);

    const history = await e2e.http
      .get('/bank-details/history')
      .set(bearer(trader))
      .expect(200);
    expect(JSON.stringify(history.body.data)).toContain(requisiteId);

    await post(id, 'decline').send({ reasonCode: 'limit_reached' }).expect(409);
    await post(id, 'confirm').expect(409);
  });
});
