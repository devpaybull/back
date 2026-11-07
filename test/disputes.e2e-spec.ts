import { Role } from '../src/common/enums/role.enum';
import { toCrypto } from '../src/common/utils/to-crypto';
import { Device } from '../src/devices/entities/device.entity';
import { Counterparty } from '../src/counterparties/entities/counterparty.entity';
import { MerchantMethod } from '../src/merchants/entities/merchant-method.entity';
import { MerchantsService } from '../src/merchants/services/merchants.service';
import { TraderSettings } from '../src/trader-settings/entities/trader-settings.entity';
import { MerchantBalance } from '../src/transactions/entities/merchant-balance.entity';
import { MethodRate } from '../src/transactions/entities/method-rate.entity';
import { TransactionDispute } from '../src/transactions/entities/transaction-dispute.entity';
import { Transaction } from '../src/transactions/entities/transaction.entity';
import { Wallet } from '../src/transactions/entities/wallet.entity';
import { DealExpiryService } from '../src/transactions/services/deal-expiry.service';
import { DisputeDeadlineService } from '../src/transactions/services/dispute-deadline.service';
import { PayoutTimersService } from '../src/transactions/services/payout-timers.service';
import { RateScope } from '../src/transactions/types/rate-scope.enum';
import { deviceOf } from './support/device-of';
import { E2eContext, E2eUser, startE2e } from './support/e2e-app';
import { bearer } from './support/flow';

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n');
const CARD = '5486732058864471';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

describe('disputes', () => {
  let e2e: E2eContext;
  let trader: E2eUser;
  let admin: E2eUser;
  let merchantId: string;
  let key: string;
  let otherKey: string;

  const v1 = (path: string, withKey = key) =>
    e2e.http.post(`/v1/${path}`).set('X-Secure-Key', withKey);
  const deal = (id: string) =>
    e2e.dataSource.getRepository(Transaction).findOneByOrFail({ id });
  const wallet = () =>
    e2e.dataSource
      .getRepository(Wallet)
      .findOneByOrFail({ userId: trader.user.id });
  const balance = async () =>
    (
      await e2e.dataSource
        .getRepository(MerchantBalance)
        .findOneByOrFail({ merchantId })
    ).balance;
  const disputeOf = (transactionId: string) =>
    e2e.dataSource
      .getRepository(TransactionDispute)
      .findOneOrFail({ where: { transactionId }, order: { id: 'DESC' } });
  const fund = (main: number, insurance = 1000) =>
    e2e.dataSource.getRepository(Wallet).update(
      { userId: trader.user.id },
      {
        mainBalance: toCrypto(main),
        mainReserved: toCrypto(0),
        insurancePayInBalance: toCrypto(insurance),
        insurancePayOutBalance: toCrypto(100000),
      },
    );

  const payIn = async (amount: string): Promise<string> =>
    (
      await v1('payment/pay-in')
        .send({
          method: 'sbp',
          amount,
          merchantTransactionId: `in-${Math.random().toString(36).slice(2)}`,
          payerInfo: { userId: 'client-1', ip: '203.0.113.7' },
        })
        .expect(201)
    ).body.data.id as string;

  const canceledPayIn = async (amount: string): Promise<string> => {
    const id = await payIn(amount);

    await e2e.http
      .post(`/trader/deals/${id}/decline`)
      .set(bearer(trader))
      .send({ reasonCode: 'limit_reached' })
      .expect(200);

    return id;
  };

  const settledPayIn = async (amount: string): Promise<string> => {
    const id = await payIn(amount);

    await e2e.http
      .post(`/trader/deals/${id}/confirm`)
      .set(bearer(trader))
      .expect(200);

    return id;
  };

  const payOutOnReview = async (): Promise<string> => {
    const id = (
      await v1('payment/pay-out')
        .send({
          method: 'card',
          amount: '9090',
          timeoutInMin: 120,
          merchantTransactionId: `out-${Math.random().toString(36).slice(2)}`,
          requisite: { ownerName: 'P P', bank: 'tbank', cardNumber: CARD },
        })
        .expect(201)
    ).body.data.id as string;

    await e2e.http
      .post(`/trader/payouts/${id}/take`)
      .set(bearer(trader))
      .expect(200);
    await e2e.http
      .post(`/trader/payouts/${id}/complete`)
      .set(bearer(trader))
      .attach('file', PDF, 'r.pdf')
      .expect(200);

    return id;
  };

  const fileKey = async (id: string): Promise<string> =>
    (
      await v1('files')
        .field('dealId', id)
        .attach('file', PDF, 'чек.pdf')
        .expect(201)
    ).body.data.fileKey as string;

  const open = async (id: string, amount?: string) =>
    v1(`payment/${id}/dispute`).send({
      fileKeys: [await fileKey(id)],
      ...(amount === undefined ? {} : { amount }),
    });

  const deadlines = (afterMs: number) =>
    e2e.app.get(DisputeDeadlineService).run(new Date(Date.now() + afterMs));

  beforeAll(async () => {
    e2e = await startE2e();
    const superadmin = await e2e.createUser(Role.Superadmin);
    admin = await e2e.createUser(Role.Admin);
    const merchants = e2e.app.get(MerchantsService);

    merchantId = (await merchants.create('Casino')).id;
    const otherId = (await merchants.create('Other')).id;
    const issue = async (id: string) =>
      (
        await e2e.http
          .post(`/admin/merchants/${id}/keys`)
          .set(bearer(superadmin))
          .expect(201)
      ).body.data.key as string;

    key = await issue(merchantId);
    otherKey = await issue(otherId);

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
      {
        scope: RateScope.Trader,
        method: 'card',
        payInPercent: 0,
        payOutPercent: 1,
      },
      {
        scope: RateScope.Merchant,
        method: 'card',
        payInPercent: 0,
        payOutPercent: 2,
      },
    ]);
    await e2e.dataSource.getRepository(MerchantMethod).save([
      { merchantId, method: 'sbp', payInEnabled: true, payOutEnabled: false },
      { merchantId, method: 'card', payInEnabled: false, payOutEnabled: true },
    ]);

    trader = await e2e.createUser(Role.Trader);
    const deviceId = await deviceOf(e2e, trader);
    await e2e.dataSource
      .getRepository(Device)
      .update(deviceId, { lastActivity: new Date(Date.now() + 100 * HOUR) });
    await e2e.dataSource.getRepository(TraderSettings).save({
      userId: trader.user.id,
      tradingEnabled: true,
      trustedUser: true,
      maxActivePayouts: 500,
    });
    await e2e.dataSource.getRepository(Wallet).save({ userId: trader.user.id });
    await e2e.http
      .post('/bank-details')
      .set(bearer(trader))
      .send({
        type: 'card_or_sbp',
        bankId,
        deviceId,
        phone: '+79010000001',
        cardholderName: 'IVAN IVANOV',
        dailyAmountLimit: '100000000.00',
      })
      .expect(201);
    await e2e.dataSource
      .getRepository(MerchantBalance)
      .save({ merchantId, balance: toCrypto(100000), escrow: toCrypto(0) });
  });

  beforeEach(async () => {
    await e2e.dataSource.query(
      `UPDATE transaction_disputes SET status = 'canceled' WHERE status IN ('deferred', 'open', 'reviewing')`,
    );
    await fund(100000);
  });

  afterAll(() => e2e.close());

  describe('pay-in', () => {
    it('canceled, a silent trader: the deadline moves no money and hands it to an admin, whose accept debits the trader without any escrow and credits the merchant', async () => {
      const id = await canceledPayIn('2000');
      const before = await wallet();
      const merchantBefore = await balance();

      const opened = await open(id, '1500.50');
      expect(opened.status).toBe(200);
      expect(opened.body.data).toMatchObject({
        status: 'dispute',
        dispute: { status: 'open', amount: '1500.50' },
      });
      expect(opened.body.data.dispute.files).toHaveLength(1);

      const row = await disputeOf(id);
      expect(row.traderDeadlineAt).toBeInstanceOf(Date);

      await deadlines(-MINUTE);
      expect((await deal(id)).status).toBe('dispute');

      const late =
        (row.traderDeadlineAt as Date).getTime() - Date.now() + MINUTE;
      await expect(deadlines(late)).resolves.toBe(1);

      expect((await deal(id)).status).toBe('manual_review');
      expect((await disputeOf(id)).status).toBe('reviewing');
      expect((await wallet()).mainBalance.toFixed(6)).toBe(
        before.mainBalance.toFixed(6),
      );
      await e2e.http
        .post(`/trader/appeals/${row.id}/accept`)
        .set(bearer(trader))
        .expect(409);

      await e2e.http
        .post(`/admin/disputes/${row.id}/accept`)
        .set(bearer(admin))
        .send({})
        .expect(200);

      const settled = await deal(id);
      expect(settled.status).toBe('success_changed');
      expect(settled.amountFiat.toFixed(2)).toBe('1500.50');
      expect(settled.originalAmountFiat?.toFixed(2)).toBe('2000.00');
      expect(settled.resolvedAt).toBeInstanceOf(Date);

      const after = await wallet();
      expect(after.mainBalance.toFixed(6)).toBe(
        before.mainBalance.minus(settled.traderAmount).toFixed(6),
      );
      expect(after.mainReserved.toFixed(6)).toBe(
        before.mainReserved.toFixed(6),
      );
      expect((await balance()).toFixed(6)).toBe(
        merchantBefore.plus(settled.merchantAmount).toFixed(6),
      );
      expect((await disputeOf(id)).status).toBe('accepted');
      await expect(deadlines(late)).resolves.toBe(0);
    });

    it('a trader short of main pays from insurance, then goes below zero on main', async () => {
      const id = await canceledPayIn('2000');
      const { traderAmount } = await deal(id);

      await fund(1, 2);
      await open(id);
      await e2e.http
        .post(`/trader/appeals/${(await disputeOf(id)).id}/accept`)
        .set(bearer(trader))
        .expect(200);

      const after = await wallet();
      expect(after.insurancePayInBalance.toFixed(6)).toBe('0.000000');
      expect(after.mainBalance.toFixed(6)).toBe(
        toCrypto(3).minus(traderAmount).toFixed(6),
      );
      expect((await deal(id)).status).toBe('success');
    });

    it('a contest with evidence stops the timer and goes to an admin, who can refuse: canceled stays canceled and no money moves', async () => {
      const id = await canceledPayIn('2100');
      await open(id);
      const { id: disputeId } = await disputeOf(id);
      const before = await wallet();

      await e2e.http
        .post(`/trader/appeals/${disputeId}/contest`)
        .set(bearer(trader))
        .field('comment', 'денег нет')
        .expect(400);

      const contested = await e2e.http
        .post(`/trader/appeals/${disputeId}/contest`)
        .set(bearer(trader))
        .field('comment', 'денег нет')
        .attach('files', PDF, 'выписка.pdf')
        .expect(200);
      expect(contested.body.data).toMatchObject({
        status: 'reviewing',
        traderAction: 'contested',
        traderComment: 'денег нет',
      });
      expect((await deal(id)).status).toBe('manual_review');

      await expect(deadlines(100 * HOUR)).resolves.toBe(0);
      await e2e.http
        .post(`/trader/appeals/${disputeId}/accept`)
        .set(bearer(trader))
        .expect(409);
      await v1(`payment/${id}/dispute/cancel`).expect(409);

      await e2e.http
        .patch(`/admin/transactions/${id}/status`)
        .set(bearer(await e2e.createUser(Role.Superadmin)))
        .send({ status: 'success', reason: 'by hand' })
        .expect(409);

      await e2e.http
        .post(`/admin/disputes/${disputeId}/reject`)
        .set(bearer(admin))
        .send({ reason: 'выписка чистая' })
        .expect(200);

      expect((await deal(id)).status).toBe('canceled');
      expect((await wallet()).mainBalance.toFixed(6)).toBe(
        before.mainBalance.toFixed(6),
      );

      const listed = await e2e.http
        .get('/admin/disputes')
        .set(bearer(admin))
        .query({ transactionId: id })
        .expect(200);
      expect(listed.body.data[0].declineReason).toBe('выписка чистая');
      expect(listed.body.data[0].files.length).toBe(2);
    });

    it('settled: only more than the amount; accepted, the trader pays the difference and the merchant gets it, once', async () => {
      const id = await settledPayIn('2000');
      const paid = await deal(id);

      expect((await open(id)).status).toBe(400);
      expect((await open(id, '2000')).status).toBe(400);
      expect((await open(id, '1000')).status).toBe(400);

      const before = await wallet();
      const merchantBefore = await balance();

      expect((await open(id, '3000')).status).toBe(200);
      expect((await deal(id)).status).toBe('dispute');
      expect((await wallet()).mainBalance.toFixed(6)).toBe(
        before.mainBalance.toFixed(6),
      );

      await e2e.http
        .post(`/admin/disputes/${(await disputeOf(id)).id}/accept`)
        .set(bearer(admin))
        .send({})
        .expect(200);

      const settled = await deal(id);
      expect(settled.status).toBe('success_changed');
      expect((await wallet()).mainBalance.toFixed(6)).toBe(
        before.mainBalance
          .minus(settled.traderAmount)
          .plus(paid.traderAmount)
          .toFixed(6),
      );
      expect((await balance()).toFixed(6)).toBe(
        merchantBefore
          .plus(settled.merchantAmount)
          .minus(paid.merchantAmount)
          .toFixed(6),
      );
    });

    it('a deal can be topped up twice; the day of the deal stays, and the counters count it once', async () => {
      const id = await settledPayIn('2000');
      const paid = await deal(id);
      const merchantBefore = await balance();
      const counterparty = () =>
        e2e.dataSource
          .getRepository(Counterparty)
          .findOneByOrFail({ id: paid.counterpartyId });
      const disputesBefore = (await counterparty()).disputeCount;

      for (const amount of ['2500', '3000']) {
        expect((await open(id, amount)).status).toBe(200);
        await e2e.http
          .post(`/admin/disputes/${(await disputeOf(id)).id}/accept`)
          .set(bearer(admin))
          .send({})
          .expect(200);
      }

      const settled = await deal(id);
      expect(settled.amountFiat.toFixed(2)).toBe('3000.00');
      expect(settled.originalAmountFiat?.toFixed(2)).toBe('2000.00');
      expect(settled.resolvedAt).toEqual(paid.resolvedAt);
      expect((await balance()).toFixed(6)).toBe(
        merchantBefore
          .plus(settled.merchantAmount)
          .minus(paid.merchantAmount)
          .toFixed(6),
      );
      expect((await counterparty()).disputeCount).toBe(disputesBefore + 1);
    });

    it('an admin’s own decision: the override is what the dispute shows, and huge ids are 404s', async () => {
      const id = await canceledPayIn('2900');

      await open(id, '2900');
      const accepted = await e2e.http
        .post(`/admin/disputes/${(await disputeOf(id)).id}/accept`)
        .set(bearer(admin))
        .send({ amount: '1200' })
        .expect(200);
      expect(accepted.body.data.amount).toBe('1200.00');

      await e2e.http
        .get('/admin/disputes/99999999999')
        .set(bearer(admin))
        .expect(404);
      await e2e.http
        .post('/trader/appeals/99999999999/accept')
        .set(bearer(trader))
        .expect(404);
    });

    it('a contest past the deadline is too late; an admin’s cancel closes a waiting dispute instead of starting it', async () => {
      const late = await canceledPayIn('3100');

      await open(late);
      const row = await disputeOf(late);
      await e2e.dataSource
        .getRepository(TransactionDispute)
        .update(row.id, { traderDeadlineAt: new Date(Date.now() - MINUTE) });
      await e2e.http
        .post(`/trader/appeals/${row.id}/contest`)
        .set(bearer(trader))
        .attach('files', PDF, 'e.pdf')
        .expect(409);

      const waiting = await payIn('3200');
      const superadmin = await e2e.createUser(Role.Superadmin);

      await open(waiting);
      await e2e.http
        .patch(`/admin/transactions/${waiting}/status`)
        .set(bearer(superadmin))
        .send({ status: 'dispute', reason: 'x' })
        .expect(409);
      await e2e.http
        .patch(`/admin/transactions/${waiting}/status`)
        .set(bearer(superadmin))
        .send({ status: 'canceled', reason: 'x' })
        .expect(200);
      expect((await deal(waiting)).status).toBe('canceled');
      expect((await disputeOf(waiting)).status).toBe('canceled');
    });

    it('settled and refused: back to success with no money moved', async () => {
      const id = await settledPayIn('2200');
      const before = await wallet();
      const merchantBefore = await balance();
      const resolvedAt = (await deal(id)).resolvedAt;

      await open(id, '3000');
      await e2e.http
        .post(`/admin/disputes/${(await disputeOf(id)).id}/reject`)
        .set(bearer(admin))
        .send({ reason: 'нет' })
        .expect(200);

      const row = await deal(id);
      expect(row.status).toBe('success');
      expect(row.resolvedAt).toEqual(resolvedAt);
      expect((await wallet()).mainBalance.toFixed(6)).toBe(
        before.mainBalance.toFixed(6),
      );
      expect((await balance()).toFixed(6)).toBe(merchantBefore.toFixed(6));
    });

    it('under-reporting: a success_changed deal is disputed back up to what was really paid', async () => {
      const id = await payIn('5000');

      await e2e.http
        .post(`/trader/deals/${id}/confirm-changed`)
        .set(bearer(trader))
        .send({ amount: '0.01' })
        .expect(200);

      const lowered = await deal(id);
      const before = await wallet();

      expect((await open(id, '5000')).status).toBe(200);
      await deadlines(100 * HOUR);
      expect((await deal(id)).status).toBe('manual_review');
      await e2e.http
        .post(`/admin/disputes/${(await disputeOf(id)).id}/accept`)
        .set(bearer(admin))
        .send({})
        .expect(200);

      const restored = await deal(id);
      expect(restored.status).toBe('success_changed');
      expect(restored.amountFiat.toFixed(2)).toBe('5000.00');
      expect(restored.originalAmountFiat?.toFixed(2)).toBe('5000.00');
      expect((await wallet()).mainBalance.toFixed(6)).toBe(
        before.mainBalance
          .minus(restored.traderAmount)
          .plus(lowered.traderAmount)
          .toFixed(6),
      );
    });

    it('deferred on active: nothing happens until the timer cancels; then it opens. A success closes it instead', async () => {
      const waiting = await payIn('2300');
      const opened = await open(waiting, '2300');

      expect(opened.body.data).toMatchObject({
        status: 'active',
        dispute: { status: 'deferred' },
      });
      expect((await open(waiting, '2300')).status).toBe(409);

      await e2e.app
        .get(DealExpiryService)
        .run(new Date(Date.now() + 100 * HOUR));
      expect((await deal(waiting)).status).toBe('dispute');
      expect((await disputeOf(waiting)).status).toBe('open');
      expect((await disputeOf(waiting)).statusBefore).toBe('canceled');

      const closing = await payIn('2400');
      await open(closing);
      await e2e.http
        .post(`/trader/deals/${closing}/confirm`)
        .set(bearer(trader))
        .expect(200);
      expect((await deal(closing)).status).toBe('success');
      expect(await disputeOf(closing)).toMatchObject({
        status: 'canceled',
        declineReason: 'deal_succeeded',
      });
    });

    it('a deal the merchant canceled itself cannot be disputed', async () => {
      const id = await payIn('2450');
      await v1(`payment/${id}/cancel`).expect(200);

      const refused = await open(id);
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe('DISPUTE_NOT_ALLOWED');
    });

    it('the merchant cancels an open dispute: back as it was', async () => {
      const id = await canceledPayIn('2500');

      await open(id);
      const canceled = await v1(`payment/${id}/dispute/cancel`).expect(200);

      expect(canceled.body.data).toMatchObject({
        status: 'canceled',
        dispute: { status: 'canceled' },
      });
      await v1(`payment/${id}/dispute/cancel`).expect(409);
      expect((await open(id)).status).toBe(200);
    });

    it('refuses what is out of reach: another merchant, old deals, foreign and used files, spoofed types', async () => {
      const id = await canceledPayIn('2600');

      await v1('files', otherKey)
        .field('dealId', id)
        .attach('file', PDF, 'a.pdf')
        .expect(404);
      await v1(`payment/${id}/dispute`, otherKey)
        .send({ fileKeys: ['00000000-0000-4000-8000-000000000000'] })
        .expect(404);

      const spoofed = await v1('files')
        .field('dealId', id)
        .attach('file', Buffer.from('<html>'), 'a.pdf')
        .expect(400);
      expect(spoofed.body.code).toBe('FILE_TYPE_NOT_ALLOWED');

      await v1(`payment/${id}/dispute`)
        .send({ fileKeys: ['00000000-0000-4000-8000-000000000000'] })
        .expect(400);
      await v1(`payment/${id}/dispute`).send({ fileKeys: [] }).expect(400);

      const used = await fileKey(id);
      await v1(`payment/${id}/dispute`)
        .send({ fileKeys: [used] })
        .expect(200);
      await v1(`payment/${id}/dispute/cancel`).expect(200);
      await v1(`payment/${id}/dispute`)
        .send({ fileKeys: [used] })
        .expect(400);

      const crowded = await canceledPayIn('2750');
      for (let count = 0; count < 5; count += 1) await fileKey(crowded);
      await v1('files')
        .field('dealId', crowded)
        .attach('file', PDF, 'a.pdf')
        .expect(409);

      const old = await canceledPayIn('2700');
      const oldFile = await fileKey(old);
      await e2e.dataSource.getRepository(Transaction).update(old, {
        createdAt: new Date(Date.now() - 15 * 24 * HOUR),
      });
      const refused = await v1(`payment/${old}/dispute`)
        .send({ fileKeys: [oldFile] })
        .expect(409);
      expect(refused.body.code).toBe('DISPUTE_NOT_ALLOWED');
    });

    it('files: the merchant reads only its own uploads, the trader the deal’s, a stranger nothing; counters count a paid dispute once', async () => {
      const id = await canceledPayIn('2800');
      const counterpartyId = (await deal(id)).counterpartyId;
      const counters = () =>
        e2e.dataSource
          .getRepository(Counterparty)
          .findOneByOrFail({ id: counterpartyId });
      const before = await counters();
      const file = await fileKey(id);

      await v1(`payment/${id}/dispute`)
        .send({ fileKeys: [file] })
        .expect(200);
      const { id: disputeId } = await disputeOf(id);

      const evidence = await e2e.http
        .post(`/trader/appeals/${disputeId}/contest`)
        .set(bearer(trader))
        .attach('files', PDF, 'e.pdf')
        .expect(200);
      const evidenceId = (
        evidence.body.data.files as { id: string; kind: string }[]
      ).find((entry) => entry.kind === 'trader_evidence')?.id as string;

      await e2e.http
        .get(`/v1/files/${file}`)
        .set('X-Secure-Key', key)
        .expect(200);
      await e2e.http
        .get(`/v1/files/${file}`)
        .set('X-Secure-Key', otherKey)
        .expect(404);
      await e2e.http
        .get(`/v1/files/${evidenceId}`)
        .set('X-Secure-Key', key)
        .expect(404);
      await e2e.http
        .get(`/trader/files/${file}`)
        .set(bearer(trader))
        .expect(200);

      await e2e.http
        .post(`/admin/disputes/${disputeId}/accept`)
        .set(bearer(admin))
        .send({})
        .expect(200);

      const after = await counters();
      expect(after.completedCount).toBe(before.completedCount);
      expect(after.paidCount).toBe(before.paidCount + 1);
      expect(after.disputeCount).toBe(before.disputeCount + 1);

      const appeals = await e2e.http
        .get('/trader/appeals')
        .set(bearer(trader))
        .query({ status: 'accepted' })
        .expect(200);
      expect(
        (appeals.body.data as { transactionId: string }[]).map(
          (row) => row.transactionId,
        ),
      ).toContain(id);
    });
  });

  describe('pay-out', () => {
    it('on review, a silent trader: after 12 hours an admin decides; accepted, it is canceled, the hold back with the merchant, nothing credited, nothing debited', async () => {
      const id = await payOutOnReview();
      const before = await wallet();
      const merchant = await e2e.dataSource
        .getRepository(MerchantBalance)
        .findOneByOrFail({ merchantId });

      expect((await open(id, '100')).status).toBe(400);
      expect((await open(id)).status).toBe(200);
      expect((await deal(id)).status).toBe('dispute');

      await e2e.app
        .get(PayoutTimersService)
        .run(new Date(Date.now() + 1500 * MINUTE));
      expect((await deal(id)).status).toBe('dispute');

      await deadlines(11 * HOUR);
      expect((await deal(id)).status).toBe('dispute');
      await deadlines(13 * HOUR);
      expect((await deal(id)).status).toBe('manual_review');
      await e2e.http
        .post(`/admin/disputes/${(await disputeOf(id)).id}/accept`)
        .set(bearer(admin))
        .send({})
        .expect(200);

      expect((await deal(id)).status).toBe('canceled');
      expect((await wallet()).mainBalance.toFixed(6)).toBe(
        before.mainBalance.toFixed(6),
      );

      const after = await e2e.dataSource
        .getRepository(MerchantBalance)
        .findOneByOrFail({ merchantId });
      expect(after.escrow.toFixed(6)).toBe(
        merchant.escrow.minus('102').toFixed(6),
      );
      expect(after.balance.toFixed(6)).toBe(
        merchant.balance.plus('102').toFixed(6),
      );
    });

    it('on review, refused by an admin: back on review, and the timer still settles it', async () => {
      const id = await payOutOnReview();

      await open(id);
      const { id: disputeId } = await disputeOf(id);
      await e2e.http
        .post(`/trader/appeals/${disputeId}/contest`)
        .set(bearer(trader))
        .attach('files', PDF, 'proof.pdf')
        .expect(200);
      await e2e.http
        .post(`/admin/disputes/${disputeId}/reject`)
        .set(bearer(admin))
        .send({ reason: 'перевод подтверждён' })
        .expect(200);

      expect((await deal(id)).status).toBe('checking');
      await e2e.app
        .get(PayoutTimersService)
        .run(new Date(Date.now() + 1500 * MINUTE));
      expect((await deal(id)).status).toBe('success');
    });

    it('after success, accepted: the trader returns the credit, the merchant is refunded, no fine', async () => {
      const id = await payOutOnReview();

      await e2e.app
        .get(PayoutTimersService)
        .run(new Date(Date.now() + 1500 * MINUTE));
      expect((await deal(id)).status).toBe('success');

      const before = await wallet();
      const merchantBefore = await balance();

      await open(id);
      await e2e.http
        .post(`/trader/appeals/${(await disputeOf(id)).id}/accept`)
        .set(bearer(trader))
        .expect(200);

      expect((await deal(id)).status).toBe('canceled');
      expect((await wallet()).mainBalance.toFixed(6)).toBe(
        before.mainBalance.minus('101').toFixed(6),
      );
      expect((await balance()).toFixed(6)).toBe(
        merchantBefore.plus('102').toFixed(6),
      );
    });
  });
});
