import { AuditLog } from '../src/audit/entities/audit-log.entity';
import { Role } from '../src/common/enums/role.enum';
import { toCrypto } from '../src/common/utils/to-crypto';
import { MerchantAttachmentKind } from '../src/merchants/types/merchant-attachment-kind.enum';
import { MerchantAttachmentMethod } from '../src/merchants/entities/merchant-attachment-method.entity';
import { MerchantAttachment } from '../src/merchants/entities/merchant-attachment.entity';
import { MerchantMethod } from '../src/merchants/entities/merchant-method.entity';
import { Merchant } from '../src/merchants/entities/merchant.entity';
import { MerchantsService } from '../src/merchants/services/merchants.service';
import { TraderSettings } from '../src/trader-settings/entities/trader-settings.entity';
import { MerchantBalance } from '../src/transactions/entities/merchant-balance.entity';
import { MethodRate } from '../src/transactions/entities/method-rate.entity';
import { PayoutDecline } from '../src/transactions/entities/payout-decline.entity';
import { TransactionFile } from '../src/transactions/entities/transaction-file.entity';
import { TransactionStatusEvent } from '../src/transactions/entities/transaction-status-event.entity';
import { Transaction } from '../src/transactions/entities/transaction.entity';
import { Wallet } from '../src/transactions/entities/wallet.entity';
import { DealExpiryService } from '../src/transactions/services/deal-expiry.service';
import { PayoutTimersService } from '../src/transactions/services/payout-timers.service';
import { RateScope } from '../src/transactions/types/rate-scope.enum';
import { E2eContext, E2eUser, startE2e } from './support/e2e-app';
import { bearer } from './support/flow';

const CARD = '5486732058864471';
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n');
const MINUTE = 60_000;

describe('the trader cabinet: pay-outs', () => {
  let e2e: E2eContext;
  let trader: E2eUser;
  let other: E2eUser;
  let merchantId: string;
  let key: string;

  const createPayOut = async (
    amount = '9090',
    timeoutInMin = 120,
  ): Promise<string> =>
    (
      await e2e.http
        .post('/v1/payment/pay-out')
        .set('X-Secure-Key', key)
        .send({
          method: 'card',
          amount,
          timeoutInMin,
          merchantTransactionId: `payout-${Math.random().toString(36).slice(2)}`,
          requisite: {
            ownerName: 'PETR PETROV',
            bank: 'tbank',
            cardNumber: CARD,
          },
        })
        .expect(201)
    ).body.data.id as string;

  const dealRow = (id: string) =>
    e2e.dataSource.getRepository(Transaction).findOneOrFail({ where: { id } });
  const walletOf = (user: E2eUser) =>
    e2e.dataSource
      .getRepository(Wallet)
      .findOneOrFail({ where: { userId: user.user.id } });
  const merchantBalance = () =>
    e2e.dataSource
      .getRepository(MerchantBalance)
      .findOneByOrFail({ merchantId });
  const take = (id: string, as: E2eUser = trader) =>
    e2e.http.post(`/trader/payouts/${id}/take`).set(bearer(as));
  const complete = (id: string, as: E2eUser = trader) =>
    e2e.http
      .post(`/trader/payouts/${id}/complete`)
      .set(bearer(as))
      .attach('file', PDF, 'чек.pdf');
  const available = (as: E2eUser = trader) =>
    e2e.http.get('/trader/payouts/available').set(bearer(as));
  const pooledIds = async (as: E2eUser = trader): Promise<string[]> =>
    ((await available(as).expect(200)).body.data as { id: string }[]).map(
      (row) => row.id,
    );
  const armTrader = async (user: E2eUser, insurance = 100000) => {
    await e2e.dataSource.getRepository(Wallet).save({
      userId: user.user.id,
      mainBalance: toCrypto(0),
      insurancePayOutBalance: toCrypto(insurance),
    });
  };
  const setSettings = (user: E2eUser, changes: Partial<TraderSettings>) =>
    e2e.dataSource
      .getRepository(TraderSettings)
      .update({ userId: user.user.id }, changes);

  beforeAll(async () => {
    e2e = await startE2e();
    const superadmin = await e2e.createUser(Role.Superadmin);
    const admin = await e2e.createUser(Role.Admin);

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
      .expect(201);

    await e2e.dataSource.getRepository(MethodRate).save([
      {
        scope: RateScope.Merchant,
        method: 'card',
        payInPercent: 0,
        payOutPercent: 2,
      },
      {
        scope: RateScope.Trader,
        method: 'card',
        payInPercent: 0,
        payOutPercent: 1,
      },
    ]);
    await e2e.dataSource.getRepository(MerchantMethod).save({
      merchantId,
      method: 'card',
      payInEnabled: false,
      payOutEnabled: true,
    });

    trader = await e2e.createUser(Role.Trader);
    other = await e2e.createUser(Role.Trader);
    for (const user of [trader, other]) {
      await e2e.dataSource
        .getRepository(TraderSettings)
        .save({ userId: user.user.id, trustedUser: true });
      await armTrader(user);
    }
  });

  beforeEach(async () => {
    await e2e.dataSource.query(
      `UPDATE transactions SET status = 'canceled' WHERE kind = 'pay_out' AND status IN ('pending', 'active')`,
    );
    const repository = e2e.dataSource.getRepository(MerchantBalance);
    const row = await repository.findOneBy({ merchantId });

    await repository.save({
      ...(row ?? { merchantId }),
      balance: toCrypto(100000),
      escrow: toCrypto(0),
    });
    await setSettings(trader, {
      trustedUser: true,
      payoutTradingEnabled: true,
      maxActivePayouts: 50,
    });
    await setSettings(other, {
      trustedUser: true,
      payoutTradingEnabled: true,
      maxActivePayouts: 50,
    });
  });

  afterAll(() => e2e.close());

  it('runs the whole cycle: pool → take → receipt → review → success, with the trader paid and the hold spent', async () => {
    const id = await createPayOut();

    const pool = await available().expect(200);
    const row = (pool.body.data as Record<string, unknown>[]).find(
      (entry) => entry.id === id,
    );

    expect(row).toMatchObject({
      status: 'pending',
      amountFiat: '9090.00',
      recipient: {
        bank: { name: 'Т-банк' },
        ownerName: 'PETR PETROV',
        cardNumber: CARD,
      },
      traderAmount: '101.000000',
      profit: '1.000000',
    });
    expect(JSON.stringify(row)).not.toContain('Casino');
    expect(JSON.stringify(row)).not.toContain(merchantId);

    await e2e.http.get(`/trader/payouts/${id}`).set(bearer(trader)).expect(404);

    const taken = await take(id).expect(200);
    expect(taken.body.data).toMatchObject({
      status: 'active',
      traderAmount: '101.000000',
      traderEffectivePercent: 1,
    });
    expect(taken.body.data.paymentDeadlineAt).toEqual(expect.any(String));
    expect(await pooledIds()).not.toContain(id);

    const balanceHeld = await merchantBalance();
    const before = await walletOf(trader);

    await e2e.http
      .post(`/trader/payouts/${id}/complete`)
      .set(bearer(trader))
      .expect(400);
    await e2e.http
      .post(`/trader/payouts/${id}/complete`)
      .set(bearer(trader))
      .attach('file', Buffer.from('MZ not a receipt at all'), 'x.pdf')
      .expect(400);
    expect((await dealRow(id)).status).toBe('active');

    const completed = await complete(id).expect(200);
    expect(completed.body.data.status).toBe('checking');
    expect(completed.body.data.receipts).toEqual([
      expect.objectContaining({ name: 'чек.pdf', mime: 'application/pdf' }),
    ]);

    await complete(id).expect(409);
    await e2e.http
      .post(`/trader/payouts/${id}/decline`)
      .set(bearer(trader))
      .send({ reasonCode: 'technical' })
      .expect(409);

    const fileId = completed.body.data.receipts[0].id as string;
    const download = await e2e.http
      .get(`/trader/files/${fileId}`)
      .set(bearer(trader))
      .expect(200);
    expect(download.headers['content-disposition']).toContain('attachment');
    expect(Buffer.from(download.body as Buffer).toString()).toBe(
      PDF.toString(),
    );
    await e2e.http
      .get(`/trader/files/${fileId}`)
      .set(bearer(other))
      .expect(404);

    const timers = e2e.app.get(PayoutTimersService);
    await timers.run(new Date(Date.now() + 1000 * MINUTE));
    expect((await dealRow(id)).status).toBe('checking');
    await e2e.app
      .get(DealExpiryService)
      .run(new Date(Date.now() + 100000 * MINUTE));
    expect((await dealRow(id)).status).toBe('checking');

    await timers.run(new Date(Date.now() + 1441 * MINUTE));

    const settled = await dealRow(id);
    expect(settled.status).toBe('success');

    const after = await walletOf(trader);
    expect(after.mainBalance.toFixed(6)).toBe(
      before.mainBalance.plus('101').toFixed(6),
    );
    const balanceAfter = await merchantBalance();
    expect(balanceAfter.escrow.toFixed(6)).toBe(
      balanceHeld.escrow.minus('102').toFixed(6),
    );
    expect(balanceAfter.balance.toFixed(6)).toBe(
      balanceHeld.balance.toFixed(6),
    );

    const events = await e2e.dataSource
      .getRepository(TransactionStatusEvent)
      .find({ where: { transactionId: id }, order: { id: 'ASC' } });
    expect(events.map((event) => [event.toStatus, event.source])).toEqual([
      ['pending', 'system'],
      ['active', 'trader'],
      ['checking', 'trader'],
      ['success', 'auto_timer'],
    ]);
    expect(
      await e2e.dataSource.getRepository(AuditLog).count({
        where: { action: 'trader.payout_completed' },
      }),
    ).toBeGreaterThanOrEqual(1);

    const listed = await e2e.http
      .get('/trader/payouts')
      .set(bearer(trader))
      .query({ status: 'success' })
      .expect(200);
    expect(
      (listed.body.data as { id: string }[]).map((entry) => entry.id),
    ).toContain(id);
    const counters = await e2e.http
      .get('/trader/payouts/counters')
      .set(bearer(trader))
      .expect(200);
    expect(counters.body.data.completed).toBeGreaterThanOrEqual(1);
    const csv = await e2e.http
      .get('/trader/payouts/export')
      .set(bearer(trader))
      .query({ search: id })
      .expect(200);
    expect(csv.text).toContain(CARD);
  });

  it('two traders race for one pay-out: one takes it, the other gets ALREADY_TAKEN', async () => {
    const id = await createPayOut();

    const answers = await Promise.all([take(id), take(id, other)]);
    const statuses = answers.map((answer) => answer.status).sort();

    expect(statuses).toEqual([200, 409]);
    expect(answers.find((answer) => answer.status === 409)?.body.code).toBe(
      'ALREADY_TAKEN',
    );
  });

  it('decline returns it to the pool, trader and price cleared, and journals it; another trader can take it', async () => {
    const id = await createPayOut();

    await take(id).expect(200);
    await e2e.http
      .post(`/trader/payouts/${id}/decline`)
      .set(bearer(trader))
      .send({ reasonCode: 'other' })
      .expect(400);
    await e2e.http
      .post(`/trader/payouts/${id}/decline`)
      .set(bearer(other))
      .send({ reasonCode: 'technical' })
      .expect(404);

    const declined = await e2e.http
      .post(`/trader/payouts/${id}/decline`)
      .set(bearer(trader))
      .send({ reasonCode: 'my_card_limit' })
      .expect(200);
    expect(declined.body.data.status).toBe('pending');

    const row = await dealRow(id);
    expect(row.traderUserId).toBeNull();
    expect(row.traderAmount).toBeNull();
    expect(row.payoutDeadlineAt).toBeNull();
    expect(
      await e2e.dataSource
        .getRepository(PayoutDecline)
        .find({ where: { transactionId: id } }),
    ).toEqual([
      expect.objectContaining({
        traderUserId: trader.user.id,
        kind: 'declined',
        reasonCode: 'my_card_limit',
      }),
    ]);

    await take(id, other).expect(200);
  });

  it('the merchant’s deadline stops at the take; the payment timer returns an overdue pay-out, and only then can that deadline cancel it', async () => {
    const id = await createPayOut('9090', 15);
    const taken = await take(id).expect(200);
    const held = await merchantBalance();
    const expiresAt = (await dealRow(id)).expiresAt as Date;

    expect(
      new Date(taken.body.data.paymentDeadlineAt as string).getTime(),
    ).toBeGreaterThan(expiresAt.getTime());

    const expiry = e2e.app.get(DealExpiryService);
    await expiry.run(new Date(Date.now() + 30 * MINUTE));
    expect((await dealRow(id)).status).toBe('active');

    const timers = e2e.app.get(PayoutTimersService);
    await timers.run(new Date(Date.now() + 59 * MINUTE));
    expect((await dealRow(id)).status).toBe('active');

    await timers.run(new Date(Date.now() + 61 * MINUTE));
    const row = await dealRow(id);
    expect(row.status).toBe('pending');
    expect(row.traderUserId).toBeNull();
    expect(
      await e2e.dataSource
        .getRepository(PayoutDecline)
        .find({ where: { transactionId: id } }),
    ).toEqual([expect.objectContaining({ kind: 'expired', reasonCode: null })]);

    await expiry.run(new Date(Date.now() + 62 * MINUTE));
    expect((await dealRow(id)).status).toBe('canceled');
    expect((await merchantBalance()).escrow.lt(held.escrow)).toBe(true);
  });

  it('a trader whose rate would pay out more than the merchant was charged sees no amount and cannot take it', async () => {
    const id = await createPayOut();
    const rates = e2e.dataSource.getRepository(MethodRate);
    const traderRate = await rates.findOneByOrFail({
      scope: RateScope.Trader,
      method: 'card',
    });

    await rates.update(traderRate.id, { payOutPercent: 3 });

    try {
      const row = (
        (await available().expect(200)).body.data as {
          id: string;
          traderAmount: string | null;
        }[]
      ).find((entry) => entry.id === id);

      expect(row?.traderAmount).toBeNull();
      expect((await take(id).expect(409)).body.code).toBe('RATE_NOT_FOUND');
    } finally {
      await rates.update(traderRate.id, { payOutPercent: 1 });
    }
  });

  it('the access switch closes the pool and take with PAYOUTS_ACCESS_DISABLED, but a taken pay-out can be finished', async () => {
    const id = await createPayOut();
    const second = await createPayOut();

    await take(id).expect(200);
    await setSettings(trader, { payoutTradingEnabled: false });

    const pool = await available().expect(403);
    expect(pool.body.code).toBe('PAYOUTS_ACCESS_DISABLED');
    expect((await take(second).expect(403)).body.code).toBe(
      'PAYOUTS_ACCESS_DISABLED',
    );

    await complete(id).expect(200);
  });

  it('the active limit: over it PAYOUT_ACTIVE_LIMIT, a personal limit overriding the env', async () => {
    await setSettings(trader, { maxActivePayouts: 1 });
    const first = await createPayOut();
    const second = await createPayOut();

    await take(first).expect(200);
    expect((await take(second).expect(409)).body.code).toBe(
      'PAYOUT_ACTIVE_LIMIT',
    );

    await complete(first).expect(200);
    await take(second).expect(200);
  });

  it('the insurance: below the minimum no pool and a 403; a Standard trader is limited by what is occupied, a trusted one is not', async () => {
    const poor = await e2e.createUser(Role.Trader);
    await e2e.dataSource
      .getRepository(TraderSettings)
      .save({ userId: poor.user.id });
    await armTrader(poor, 100);
    const id = await createPayOut();

    expect(await pooledIds(poor)).toEqual([]);
    expect((await take(id, poor).expect(403)).body.code).toBe(
      'INSURANCE_BELOW_MINIMUM',
    );

    const standard = await e2e.createUser(Role.Trader);
    await e2e.dataSource
      .getRepository(TraderSettings)
      .save({ userId: standard.user.id });
    await armTrader(standard, 300);

    const big = await createPayOut('27000');
    const next = await createPayOut('2000');

    expect(await pooledIds(standard)).toContain(big);
    await take(big, standard).expect(200);
    expect((await take(next, standard).expect(409)).body.code).toBe(
      'PAYOUT_INSURANCE_LIMIT',
    );

    await setSettings(standard, { trustedUser: true });
    await take(next, standard).expect(200);
  });

  it('admission: an exclusive merchant hides its pay-outs from a trader who is not attached', async () => {
    const id = await createPayOut();
    await e2e.dataSource
      .getRepository(Merchant)
      .update(merchantId, { exclusiveTopUp: true });

    try {
      expect(await pooledIds()).not.toContain(id);
      await take(id).expect(404);

      const attachment = await e2e.dataSource
        .getRepository(MerchantAttachment)
        .save({
          merchantId,
          userId: trader.user.id,
          kind: MerchantAttachmentKind.Trader,
          trading: true,
        });
      await e2e.dataSource.getRepository(MerchantAttachmentMethod).save({
        attachmentId: attachment.id,
        method: 'card',
        enabled: true,
      });

      expect(await pooledIds()).toContain(id);
      await take(id).expect(200);
    } finally {
      await e2e.dataSource
        .getRepository(Merchant)
        .update(merchantId, { exclusiveTopUp: false });
    }
  });

  it('an admin reads the receipt, and cannot move a trader on or off by hand', async () => {
    const superadmin = await e2e.createUser(Role.Superadmin);
    const id = await createPayOut();

    await e2e.http
      .patch(`/admin/transactions/${id}/status`)
      .set(bearer(superadmin))
      .send({ status: 'active', reason: 'try' })
      .expect(409);

    await take(id).expect(200);
    await e2e.http
      .patch(`/admin/transactions/${id}/status`)
      .set(bearer(superadmin))
      .send({ status: 'pending', reason: 'try' })
      .expect(409);

    await complete(id).expect(200);

    const files = await e2e.http
      .get(`/admin/transactions/${id}/files`)
      .set(bearer(superadmin))
      .expect(200);
    expect(files.body.data).toEqual([
      expect.objectContaining({ kind: 'payout_receipt', name: 'чек.pdf' }),
    ]);

    const fileId = files.body.data[0].id as string;
    const download = await e2e.http
      .get(`/admin/transactions/${id}/files/${fileId}`)
      .set(bearer(superadmin))
      .expect(200);
    expect(Buffer.from(download.body as Buffer).toString()).toBe(
      PDF.toString(),
    );
    await e2e.http
      .get(`/admin/transactions/${id}/files/${fileId}`)
      .set(bearer(trader))
      .expect(403);
    await e2e.http
      .get(
        `/admin/transactions/00000000-0000-4000-8000-000000000000/files/${fileId}`,
      )
      .set(bearer(superadmin))
      .expect(404);
  });

  it('refuses more text fields than an upload may carry', async () => {
    const id = await createPayOut();
    await take(id).expect(200);

    await e2e.http
      .post(`/trader/payouts/${id}/complete`)
      .set(bearer(trader))
      .field('a', 'x')
      .field('b', 'x')
      .field('c', 'x')
      .attach('file', PDF, 'r.pdf')
      .expect(400);
    expect((await dealRow(id)).status).toBe('active');
  });

  it('a personal limit needs a reason from the admin', async () => {
    const admin = await e2e.createUser(Role.Admin);

    await e2e.http
      .patch(`/admin/users/${other.user.id}/settings`)
      .set(bearer(admin))
      .send({ maxActivePayouts: 7 })
      .expect(400);
    const changed = await e2e.http
      .patch(`/admin/users/${other.user.id}/settings`)
      .set(bearer(admin))
      .send({ maxActivePayouts: 7, reason: 'trusted volume' })
      .expect(200);
    expect(changed.body.data.maxActivePayouts).toBe(7);
  });

  it('a merchant cannot cancel a pay-out that is on review, and the receipt row stays tied to the deal', async () => {
    const id = await createPayOut();
    await take(id).expect(200);
    await complete(id).expect(200);

    await e2e.http
      .post(`/v1/payment/${id}/cancel`)
      .set('X-Secure-Key', key)
      .expect(409);
    expect(
      await e2e.dataSource.getRepository(TransactionFile).count({
        where: { transactionId: id, kind: 'payout_receipt' as never },
      }),
    ).toBe(1);
  });
});
