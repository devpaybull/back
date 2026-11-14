import Decimal from 'decimal.js';
import { Role } from '../src/common/enums/role.enum';
import { toCrypto } from '../src/common/utils/to-crypto';
import { toDecimal } from '../src/common/utils/to-decimal';
import { Device } from '../src/devices/entities/device.entity';
import { MerchantCallback } from '../src/merchant-callbacks/entities/merchant-callback.entity';
import { MerchantCallbackSenderService } from '../src/merchant-callbacks/services/merchant-callback-sender.service';
import { CallbackHttpClient } from '../src/merchant-callbacks/types/callback-http-client';
import { MerchantMethod } from '../src/merchants/entities/merchant-method.entity';
import { MerchantsService } from '../src/merchants/services/merchants.service';
import { TraderSettings } from '../src/trader-settings/entities/trader-settings.entity';
import { MerchantBalanceOperation } from '../src/transactions/entities/merchant-balance-operation.entity';
import { MerchantBalance } from '../src/transactions/entities/merchant-balance.entity';
import { MethodRate } from '../src/transactions/entities/method-rate.entity';
import { TransactionDispute } from '../src/transactions/entities/transaction-dispute.entity';
import { TransactionLeadShare } from '../src/transactions/entities/transaction-lead-share.entity';
import { Transaction } from '../src/transactions/entities/transaction.entity';
import { Wallet } from '../src/transactions/entities/wallet.entity';
import { PayoutTimersService } from '../src/transactions/services/payout-timers.service';
import { RateScope } from '../src/transactions/types/rate-scope.enum';
import { User } from '../src/users/entities/user.entity';
import { deviceOf } from './support/device-of';
import { E2eContext, E2eUser, startE2e } from './support/e2e-app';
import { bearer } from './support/flow';

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n');
const CARD = '2200700012345678';
const PAYOUT_CARD = '5486732058864471';
const HOOK = 'https://merchant.example/hook';
const DESTINATION = 'TKTX96CBxr5kvhjsDHcqoiPWZageGxoTW3';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const UNKNOWN = '00000000-0000-4000-8000-000000000000';

type Sums = { trader: Decimal; lead: Decimal; merchant: Decimal };

describe('admin deal actions', () => {
  let e2e: E2eContext;
  let superadmin: E2eUser;
  let admin: E2eUser;
  let trader: E2eUser;
  let lead: E2eUser;
  let merchant: E2eUser;
  let merchantId: string;
  let key: string;
  let post: jest.SpyInstance;
  let amountSeq = 2000;

  const nextAmount = (): string => String((amountSeq += 13));
  const v1 = (path: string) =>
    e2e.http.post(`/v1/${path}`).set('X-Secure-Key', key);
  const adminPost = (id: string, action: string, as: E2eUser = superadmin) =>
    e2e.http.post(`/admin/transactions/${id}/${action}`).set(bearer(as));
  const deal = (id: string) =>
    e2e.dataSource.getRepository(Transaction).findOneByOrFail({ id });
  const walletOf = (user: E2eUser) =>
    e2e.dataSource
      .getRepository(Wallet)
      .findOneByOrFail({ userId: user.user.id });
  const merchantRow = () =>
    e2e.dataSource
      .getRepository(MerchantBalance)
      .findOneByOrFail({ merchantId });
  const setMerchantBalance = (balance: string) =>
    e2e.dataSource
      .getRepository(MerchantBalance)
      .update({ merchantId }, { balance: toCrypto(balance) });
  const merchantOps = (transactionId: string) =>
    e2e.dataSource.getRepository(MerchantBalanceOperation).find({
      where: { transactionId },
      order: { id: 'ASC' },
    });
  const sharesOf = (transactionId: string) =>
    e2e.dataSource
      .getRepository(TransactionLeadShare)
      .find({ where: { transactionId } });
  const callbacksOf = (transactionId: string) =>
    e2e.dataSource
      .getRepository(MerchantCallback)
      .find({ where: { transactionId }, order: { createdAt: 'ASC' } });

  const journalSums = async (transactionId: string): Promise<Sums> => {
    const walletRows: { userId: string; total: string }[] =
      await e2e.dataSource.query(
        `SELECT w."userId" AS "userId", COALESCE(SUM(o.amount), 0)::text AS total
           FROM balance_operations o JOIN wallets w ON w.id = o."walletId"
          WHERE o."transactionId" = $1 AND o."balanceKind" = 'main'
          GROUP BY w."userId"`,
        [transactionId],
      );
    const of = (userId: string) =>
      toDecimal(walletRows.find((row) => row.userId === userId)?.total ?? 0);
    const merchantTotal = (await merchantOps(transactionId)).reduce(
      (sum, op) => sum.plus(op.amount),
      toDecimal(0),
    );

    return {
      trader: of(trader.user.id),
      lead: of(lead.user.id),
      merchant: merchantTotal,
    };
  };

  const payIn = async (
    amount: string,
    extra: Record<string, unknown> = {},
  ): Promise<string> =>
    (
      await v1('payment/pay-in')
        .send({
          method: 'sbp',
          amount,
          merchantTransactionId: `in-${Math.random().toString(36).slice(2)}`,
          payerInfo: { userId: 'client-1', ip: '203.0.113.7' },
          ...extra,
        })
        .expect(201)
    ).body.data.id as string;

  const payOut = async (amount = '9090'): Promise<string> =>
    (
      await v1('payment/pay-out')
        .send({
          method: 'card',
          amount,
          timeoutInMin: 120,
          merchantTransactionId: `out-${Math.random().toString(36).slice(2)}`,
          requisite: {
            ownerName: 'PETR PETROV',
            bank: 'tbank',
            cardNumber: PAYOUT_CARD,
          },
        })
        .expect(201)
    ).body.data.id as string;

  const confirmByTrader = (id: string) =>
    e2e.http
      .post(`/trader/deals/${id}/confirm`)
      .set(bearer(trader))
      .expect(200);

  const freshTotp = async (user: E2eUser) => {
    await e2e.dataSource
      .getRepository(User)
      .update(user.user.id, { withdrawalTotpLastStep: null });

    return e2e.totp(user);
  };

  const expectFixed = (actual: Decimal, expected: Decimal) =>
    expect(actual.toFixed(6)).toBe(expected.toFixed(6));

  beforeAll(async () => {
    e2e = await startE2e();
    superadmin = await e2e.createUser(Role.Superadmin);
    admin = await e2e.createUser(Role.Admin);

    merchantId = (await e2e.app.get(MerchantsService).create('Casino')).id;
    key = (
      await e2e.http
        .post(`/admin/merchants/${merchantId}/keys`)
        .set(bearer(superadmin))
        .expect(201)
    ).body.data.key as string;
    merchant = await e2e.createUser(Role.Merchant, { merchantId });

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
    lead = await e2e.createUser(Role.LeadTrader);
    await e2e.http
      .post(`/admin/users/${trader.user.id}/leads`)
      .set(bearer(superadmin))
      .send({
        leadUserId: lead.user.id,
        currencyId: currency.body.data.id,
        payInPercent: 2,
        payOutPercent: 0,
      })
      .expect(201);

    const deviceId = await deviceOf(e2e, trader);
    await e2e.dataSource
      .getRepository(Device)
      .update(deviceId, { lastActivity: new Date(Date.now() + 100 * HOUR) });
    await e2e.dataSource.getRepository(TraderSettings).save({
      userId: trader.user.id,
      tradingEnabled: true,
      payoutTradingEnabled: true,
      nightStopEnabled: false,
      trustedUser: true,
      maxActivePayouts: 500,
    });
    await e2e.dataSource.getRepository(Wallet).save({
      userId: trader.user.id,
      mainBalance: toCrypto(100000),
      insurancePayInBalance: toCrypto(1000),
      insurancePayOutBalance: toCrypto(100000),
    });
    await e2e.http
      .post('/trader/requisites')
      .set(bearer(trader))
      .send({
        type: 'card_or_sbp',
        bankId,
        deviceId,
        phone: '+79010000001',
        card: CARD,
        cardholderName: 'IVAN IVANOV',
        dailyAmountLimit: '100000000.00',
      })
      .expect(201);
    await e2e.dataSource
      .getRepository(MerchantBalance)
      .save({ merchantId, balance: toCrypto(100000), escrow: toCrypto(0) });

    post = jest.spyOn(e2e.app.get(CallbackHttpClient), 'post');
  });

  beforeEach(async () => {
    post.mockReset();
    post.mockImplementation(async () => ({ statusCode: 200, body: 'ok' }));
    await setMerchantBalance('100000');
  });

  afterAll(() => e2e?.close());

  describe('a pay-in: close, change the amount, cancel the settled, restore', () => {
    let id: string;

    it('close moves the money exactly as a trader confirm does', async () => {
      const amount = nextAmount();
      const confirmed = await payIn(amount);
      await confirmByTrader(confirmed);

      id = await payIn(amount);
      const created = await deal(id);
      const traderBefore = await walletOf(trader);
      const leadBefore = await walletOf(lead);
      const merchantBefore = (await merchantRow()).balance;

      await adminPost(id, 'close', admin).expect(200);
      await adminPost(id, 'close', admin).expect(409);

      const closed = await deal(id);
      expect(closed.status).toBe('success');
      const [share] = await sharesOf(id);
      expect(share.leadUserId).toBe(lead.user.id);
      expect(share.amount.gt(0)).toBe(true);

      const traderAfter = await walletOf(trader);
      expectFixed(
        traderAfter.mainBalance,
        traderBefore.mainBalance.minus(created.traderAmount),
      );
      expectFixed(
        traderAfter.mainReserved,
        traderBefore.mainReserved.minus(created.traderAmount),
      );
      expectFixed(
        (await walletOf(lead)).mainBalance,
        leadBefore.mainBalance.plus(share.amount),
      );
      expectFixed(
        (await merchantRow()).balance,
        merchantBefore.plus(created.merchantAmount),
      );

      const viaAdmin = await journalSums(id);
      const viaTrader = await journalSums(confirmed);
      expectFixed(viaAdmin.trader, viaTrader.trader);
      expectFixed(viaAdmin.lead, viaTrader.lead);
      expectFixed(viaAdmin.merchant, viaTrader.merchant);
      expect((await merchantOps(id)).map((op) => op.type)).toEqual(
        (await merchantOps(confirmed)).map((op) => op.type),
      );
    });

    it('amount up then down: success_changed, the first amount kept, only the difference moves, and no money is created', async () => {
      const first = await deal(id);
      const [shareBefore] = await sharesOf(id);
      const up = toDecimal(first.amountFiat).plus(500).toFixed(2);

      await adminPost(id, 'amount', admin)
        .send({ amountFiat: up, reason: 'выписка' })
        .expect(403);

      for (const amountFiat of [
        up,
        toDecimal(first.amountFiat).minus(300).toFixed(2),
      ]) {
        const before = await deal(id);
        const [share] = await sharesOf(id);
        const traderBefore = await walletOf(trader);
        const leadBefore = await walletOf(lead);
        const merchantBefore = (await merchantRow()).balance;

        const answered = await adminPost(id, 'amount')
          .send({ amountFiat, reason: 'выписка' })
          .expect(200);
        expect(answered.body.data.status).toBe('success_changed');

        const after = await deal(id);
        const [shareAfter] = await sharesOf(id);
        expect(after.status).toBe('success_changed');
        expect(after.amountFiat.toFixed(2)).toBe(amountFiat);
        expect(after.originalAmountFiat?.toFixed(2)).toBe(
          first.amountFiat.toFixed(2),
        );
        expect(after.originalTraderAmount?.toFixed(6)).toBe(
          first.traderAmount.toFixed(6),
        );
        expectFixed(
          (await walletOf(trader)).mainBalance,
          traderBefore.mainBalance
            .minus(after.traderAmount)
            .plus(before.traderAmount),
        );
        expectFixed(
          (await walletOf(trader)).mainReserved,
          traderBefore.mainReserved,
        );
        expectFixed(
          (await walletOf(lead)).mainBalance,
          leadBefore.mainBalance.plus(shareAfter.amount).minus(share.amount),
        );
        expectFixed(
          (await merchantRow()).balance,
          merchantBefore
            .plus(after.merchantAmount)
            .minus(before.merchantAmount),
        );
      }

      const settled = await deal(id);
      const [share] = await sharesOf(id);
      expect(share.amount.eq(shareBefore.amount)).toBe(false);
      const sums = await journalSums(id);
      expectFixed(sums.trader, toDecimal(settled.traderAmount).neg());
      expectFixed(sums.lead, share.amount);
      expectFixed(sums.merchant, settled.merchantAmount);
      expectFixed(settled.leadCommission ?? toDecimal(0), share.amount);
      const platform = toDecimal(settled.merchantCommission)
        .minus(settled.traderCommission)
        .minus(settled.leadCommission ?? 0);
      expect(platform.gte(0)).toBe(true);
      expectFixed(
        sums.trader.neg().minus(sums.merchant).minus(sums.lead),
        platform,
      );
      expect((await merchantOps(id)).map((op) => op.type)).toEqual([
        'deal_pay_in',
        'deal_correction',
        'deal_correction',
      ]);

      const card = await e2e.http
        .get(`/admin/transactions/${id}`)
        .set(bearer(superadmin))
        .expect(200);
      expect(card.body.data).toMatchObject({
        status: 'success_changed',
        originalAmountFiat: first.amountFiat.toFixed(2),
        leadShares: [
          {
            leadUserId: lead.user.id,
            amount: share.amount.toFixed(6),
          },
        ],
      });
      expect(card.body.data.actions).toEqual(
        expect.arrayContaining(['change_amount', 'cancel_settled']),
      );
      const changes = (
        card.body.data.history as {
          toStatus: string;
          actor: { id: string } | null;
          reason: string | null;
        }[]
      ).filter((entry) => entry.toStatus === 'success_changed');
      expect(changes).toHaveLength(2);
      expect(
        changes.every((entry) => entry.actor?.id === superadmin.user.id),
      ).toBe(true);
      expect(
        (
          card.body.data.history as {
            actor: { id: string } | null;
            toStatus: string;
          }[]
        ).some(
          (entry) =>
            entry.toStatus === 'success' && entry.actor?.id === admin.user.id,
        ),
      ).toBe(true);

      const asAdmin = await e2e.http
        .get(`/admin/transactions/${id}`)
        .set(bearer(admin))
        .expect(200);
      expect(asAdmin.body.data.actions).not.toContain('change_amount');
    });

    it('cancel-settled the merchant cannot give back: a 409 with shortfalls and nothing moved; confirmed, the merchant goes negative and new holds are refused', async () => {
      const settled = await deal(id);
      const [share] = await sharesOf(id);

      await adminPost(id, 'cancel-settled', admin)
        .send({ reason: 'фрод' })
        .expect(403);

      await setMerchantBalance('1');
      const traderBefore = await walletOf(trader);
      const leadBefore = await walletOf(lead);

      const refused = await adminPost(id, 'cancel-settled')
        .send({ reason: 'фрод' })
        .expect(409);
      expect(refused.body).toMatchObject({
        code: 'OVERDRAFT_NOT_CONFIRMED',
        shortfalls: [
          {
            party: 'merchant',
            id: merchantId,
            shortfall: toDecimal(settled.merchantAmount).minus(1).toFixed(6),
          },
        ],
      });
      expect((await deal(id)).status).toBe('success_changed');
      expect((await merchantRow()).balance.toFixed(6)).toBe('1.000000');
      expectFixed(
        (await walletOf(trader)).mainBalance,
        traderBefore.mainBalance,
      );
      expectFixed((await walletOf(lead)).mainBalance, leadBefore.mainBalance);

      await adminPost(id, 'cancel-settled')
        .send({ reason: 'фрод', confirmOverdraft: true })
        .expect(200);

      expect((await deal(id)).status).toBe('canceled');
      const negative = (await merchantRow()).balance;
      expectFixed(negative, toDecimal(1).minus(settled.merchantAmount));
      expect(negative.lt(0)).toBe(true);
      expectFixed(
        (await walletOf(trader)).mainBalance,
        traderBefore.mainBalance.plus(settled.traderAmount),
      );
      expectFixed(
        (await walletOf(lead)).mainBalance,
        leadBefore.mainBalance.minus(share.amount),
      );
      const sums = await journalSums(id);
      expect(sums.trader.isZero()).toBe(true);
      expect(sums.lead.isZero()).toBe(true);
      expect(sums.merchant.isZero()).toBe(true);

      const payout = await v1('payment/pay-out')
        .send({
          method: 'card',
          amount: '9090',
          timeoutInMin: 120,
          merchantTransactionId: `out-${Math.random().toString(36).slice(2)}`,
          requisite: {
            ownerName: 'P P',
            bank: 'tbank',
            cardNumber: PAYOUT_CARD,
          },
        })
        .expect(409);
      expect(payout.body.code).toBe('MERCHANT_BALANCE_NEGATIVE');

      await e2e.http
        .get('/merchant/withdrawals/quote')
        .set(bearer(merchant))
        .query({ address: DESTINATION, amount: '10' })
        .expect(200);
      const withdrawal = await e2e.http
        .post('/merchant/withdrawals')
        .set(bearer(merchant))
        .send({
          amount: '10',
          address: DESTINATION,
          totp: await freshTotp(merchant),
        })
        .expect(409);
      expect(withdrawal.body.code).toBe('MERCHANT_BALANCE_NEGATIVE');
      expectFixed((await merchantRow()).balance, negative);

      const overdraft = (payoutOverdraftEnabled: boolean) =>
        e2e.http
          .patch(`/admin/merchants/${merchantId}/settings`)
          .set(bearer(superadmin))
          .send({ payoutOverdraftEnabled })
          .expect(200);
      await overdraft(true);
      const allowed = await payOut('9450');
      const allowedRow = await deal(allowed);
      expectFixed(
        (await merchantRow()).balance,
        negative.minus(allowedRow.merchantAmount),
      );
      await overdraft(false);
      await adminPost(allowed, 'cancel-payout', admin).send({}).expect(200);
      expectFixed((await merchantRow()).balance, negative);
    });

    it('restore: superadmin only; the changed pay-in comes back as success_changed with the merchant credited by a correction', async () => {
      const canceled = await deal(id);
      const [share] = await sharesOf(id);

      await adminPost(id, 'restore', admin)
        .send({ reason: 'нашли' })
        .expect(403);

      const traderBefore = await walletOf(trader);
      const leadBefore = await walletOf(lead);
      const merchantBefore = (await merchantRow()).balance;

      const restored = await adminPost(id, 'restore')
        .send({ reason: 'нашли' })
        .expect(200);
      expect(restored.body.data.status).toBe('success_changed');
      await adminPost(id, 'restore').send({ reason: 'нашли' }).expect(409);

      expectFixed(
        (await walletOf(trader)).mainBalance,
        traderBefore.mainBalance.minus(canceled.traderAmount),
      );
      expectFixed(
        (await walletOf(lead)).mainBalance,
        leadBefore.mainBalance.plus(share.amount),
      );
      expectFixed(
        (await merchantRow()).balance,
        merchantBefore.plus(canceled.merchantAmount),
      );
      const ops = (await merchantOps(id)).map((op) => op.type);
      expect(ops.filter((type) => type === 'deal_pay_in')).toHaveLength(1);
      expect(ops[ops.length - 1]).toBe('deal_correction');
    });

    it('restore of a pay-in the trader declined: success, the merchant credited by deal_pay_in', async () => {
      const declined = await payIn(nextAmount());
      await e2e.http
        .post(`/trader/deals/${declined}/decline`)
        .set(bearer(trader))
        .send({ reasonCode: 'limit_reached' })
        .expect(200);
      const row = await deal(declined);
      const merchantBefore = (await merchantRow()).balance;

      const restored = await adminPost(declined, 'restore')
        .send({ reason: 'платёж нашёлся' })
        .expect(200);
      expect(restored.body.data.status).toBe('success');
      expectFixed(
        (await merchantRow()).balance,
        merchantBefore.plus(row.merchantAmount),
      );
      expect((await merchantOps(declined)).map((op) => op.type)).toEqual([
        'deal_pay_in',
      ]);
    });
  });

  describe('a pay-out: assign, cancel, revive', () => {
    it('assign → active by admin; cancel releases the hold; assign again holds again; the trader finishes and the escrow is spent exactly once', async () => {
      const startEscrow = (await merchantRow()).escrow;
      const id = await payOut();
      const created = await deal(id);
      const held = await merchantRow();
      expectFixed(held.escrow, startEscrow.plus(created.merchantAmount));
      expectFixed(
        held.balance,
        toDecimal(100000).minus(created.merchantAmount),
      );

      const assigned = await adminPost(id, 'assign', admin)
        .send({ traderUserId: trader.user.id })
        .expect(200);
      expect(assigned.body.data.status).toBe('active');
      const taken = await deal(id);
      expect(taken.traderUserId).toBe(trader.user.id);
      expect(taken.payoutAssignedBy).toBe('admin');

      const card = await e2e.http
        .get(`/admin/transactions/${id}`)
        .set(bearer(admin))
        .expect(200);
      expect(
        (
          card.body.data.history as {
            toStatus: string;
            actor: { id: string } | null;
            source: string;
          }[]
        ).find((entry) => entry.toStatus === 'active'),
      ).toMatchObject({ source: 'admin', actor: { id: admin.user.id } });
      expect(card.body.data.actions).toContain('cancel_payout');

      await adminPost(id, 'cancel-payout', admin)
        .send({ reason: 'дубль' })
        .expect(200);
      expect((await deal(id)).status).toBe('canceled');
      const released = await merchantRow();
      expectFixed(released.escrow, startEscrow);
      expectFixed(released.balance, toDecimal(100000));
      await adminPost(id, 'cancel-payout', admin).send({}).expect(409);

      const revived = await adminPost(id, 'assign', admin)
        .send({ traderUserId: trader.user.id })
        .expect(200);
      expect(revived.body.data.status).toBe('active');
      const reheld = await merchantRow();
      expectFixed(reheld.escrow, startEscrow.plus(created.merchantAmount));
      expectFixed(
        reheld.balance,
        toDecimal(100000).minus(created.merchantAmount),
      );
      const live = await deal(id);
      expect(live.resolvedAt).toBeNull();
      expect(live.expiresAt!.getTime()).toBeGreaterThan(Date.now());

      const traderBefore = await walletOf(trader);
      await e2e.http
        .post(`/trader/payouts/${id}/complete`)
        .set(bearer(trader))
        .attach('file', PDF, 'чек.pdf')
        .expect(200);
      expect((await deal(id)).status).toBe('checking');

      const timers = e2e.app.get(PayoutTimersService);
      await timers.run(new Date(Date.now() + 1500 * MINUTE));
      await timers.run(new Date(Date.now() + 1600 * MINUTE));

      const done = await deal(id);
      expect(done.status).toBe('success');
      const after = await merchantRow();
      expectFixed(after.escrow, startEscrow);
      expectFixed(
        after.balance,
        toDecimal(100000).minus(created.merchantAmount),
      );
      expectFixed(
        (await walletOf(trader)).mainBalance,
        traderBefore.mainBalance.plus(done.traderAmount),
      );

      const ops = await merchantOps(id);
      expect(ops.map((op) => op.type)).toEqual([
        'deal_pay_out_escrow',
        'deal_pay_out_escrow_release',
        'deal_pay_out_escrow',
        'deal_pay_out',
      ]);
      const escrowNet = ops.reduce(
        (sum, op) => sum.plus(op.escrowAfter).minus(op.escrowBefore),
        toDecimal(0),
      );
      expect(escrowNet.isZero()).toBe(true);
    });

    it('reviving when the merchant cannot cover the hold: 409 OVERDRAFT_NOT_CONFIRMED, then with the flag it is held below zero', async () => {
      const id = await payOut('9180');
      await adminPost(id, 'cancel-payout', admin).send({}).expect(200);
      const row = await deal(id);
      expect(row.traderUserId).toBeNull();

      await setMerchantBalance('1');
      const refused = await adminPost(id, 'assign', admin)
        .send({ traderUserId: trader.user.id })
        .expect(409);
      expect(refused.body).toMatchObject({
        code: 'OVERDRAFT_NOT_CONFIRMED',
        shortfalls: [
          {
            party: 'merchant',
            id: merchantId,
            shortfall: toDecimal(row.merchantAmount).minus(1).toFixed(6),
          },
        ],
      });
      expect((await deal(id)).status).toBe('canceled');
      expect((await merchantRow()).balance.toFixed(6)).toBe('1.000000');

      await adminPost(id, 'assign', admin)
        .send({ traderUserId: trader.user.id, confirmOverdraft: true })
        .expect(200);
      expect((await deal(id)).status).toBe('active');
      expectFixed(
        (await merchantRow()).balance,
        toDecimal(1).minus(row.merchantAmount),
      );

      await adminPost(id, 'cancel-payout', admin).send({}).expect(200);
      expect((await merchantRow()).balance.toFixed(6)).toBe('1.000000');
    });

    it('assign refuses what is not an active trader', async () => {
      const id = await payOut('9270');

      await adminPost(id, 'assign', admin)
        .send({ traderUserId: lead.user.id })
        .expect(400);
      await adminPost(id, 'assign', admin)
        .send({ traderUserId: UNKNOWN })
        .expect(400);
      await adminPost(id, 'cancel-payout', admin).send({}).expect(200);
    });
  });

  describe('an admin dispute', () => {
    it('on a settled pay-in with a higher amount: dispute, the receipt is the admin’s, a callback queued; a second one and a pool pay-out are refused', async () => {
      const id = await payIn(nextAmount(), { callbackUrl: HOOK });
      await confirmByTrader(id);
      await e2e.dataSource.query(
        `UPDATE merchant_callbacks SET status = 'delivered' WHERE "transactionId" = $1`,
        [id],
      );
      const callbacksBefore = (await callbacksOf(id)).length;
      const row = await deal(id);
      const higher = toDecimal(row.amountFiat).plus(1000).toFixed(2);

      await adminPost(id, 'dispute', admin)
        .field('amountFiat', higher)
        .expect(400);

      const opened = await adminPost(id, 'dispute', admin)
        .field('amountFiat', higher)
        .attach('file', PDF, 'чек.pdf')
        .expect(200);
      expect(opened.body.data.status).toBe('dispute');
      expect((await deal(id)).status).toBe('dispute');

      const files = await e2e.http
        .get(`/admin/transactions/${id}/files`)
        .set(bearer(admin))
        .expect(200);
      expect(files.body.data).toEqual([
        expect.objectContaining({
          kind: 'dispute_receipt',
          uploadedByUserId: admin.user.id,
        }),
      ]);
      const queued = (await callbacksOf(id)).slice(callbacksBefore);
      expect(queued.length).toBeGreaterThan(0);
      expect(queued.some((callback) => callback.status === 'pending')).toBe(
        true,
      );

      const again = await adminPost(id, 'dispute', admin)
        .field('amountFiat', toDecimal(higher).plus(1).toFixed(2))
        .attach('file', PDF, 'чек.pdf')
        .expect(409);
      expect(again.body.code).toBe('DISPUTE_NOT_ALLOWED');
      await adminPost(id, 'amount')
        .send({ amountFiat: higher, reason: 'x' })
        .expect(409)
        .expect(({ body }) => expect(body.code).toBe('DEAL_NOT_SETTLED'));

      const dispute = await e2e.dataSource
        .getRepository(TransactionDispute)
        .findOneByOrFail({ transactionId: id });
      await e2e.http
        .post(`/admin/disputes/${dispute.id}/reject`)
        .set(bearer(admin))
        .send({ reason: 'нет' })
        .expect(200);
      expect((await deal(id)).status).toBe('success');

      const pool = await payOut('9360');
      const noTrader = await adminPost(pool, 'dispute', admin)
        .attach('file', PDF, 'чек.pdf')
        .expect(409);
      expect(noTrader.body.code).toBe('NO_TRADER_TO_DISPUTE');

      await adminPost(pool, 'cancel-payout', admin).send({}).expect(200);
      const canceledPool = await adminPost(pool, 'dispute', admin)
        .attach('file', PDF, 'чек.pdf')
        .expect(409);
      expect(canceledPool.body.code).toBe('NO_TRADER_TO_DISPUTE');
    });

    const canceledPayOutWithTrader = async (amount: string) => {
      const id = await payOut(amount);
      await adminPost(id, 'assign', admin)
        .send({ traderUserId: trader.user.id })
        .expect(200);
      await adminPost(id, 'cancel-payout', admin).send({}).expect(200);
      const card = await e2e.http
        .get(`/admin/transactions/${id}`)
        .set(bearer(admin))
        .expect(200);
      expect(card.body.data.actions).toContain('open_dispute');
      await adminPost(id, 'dispute', admin)
        .attach('file', PDF, 'чек.pdf')
        .expect(200);
      expect((await deal(id)).status).toBe('dispute');

      return {
        id,
        disputeId: (
          await e2e.dataSource
            .getRepository(TransactionDispute)
            .findOneByOrFail({ transactionId: id })
        ).id,
      };
    };

    it('on a canceled pay-out with a trader, accepted: an overdraft needs the flag; then success, the trader credited and the merchant charged by deal_pay_out', async () => {
      const { id, disputeId } = await canceledPayOutWithTrader('9540');
      const row = await deal(id);
      const shares = await sharesOf(id);
      const opsBefore = (await merchantOps(id)).length;
      const startEscrow = (await merchantRow()).escrow;

      await setMerchantBalance('1');
      const traderBefore = await walletOf(trader);
      const leadBefore = await walletOf(lead);

      const refused = await e2e.http
        .post(`/admin/disputes/${disputeId}/accept`)
        .set(bearer(admin))
        .send({})
        .expect(409);
      expect(refused.body).toMatchObject({
        code: 'OVERDRAFT_NOT_CONFIRMED',
        shortfalls: [
          {
            party: 'merchant',
            id: merchantId,
            shortfall: toDecimal(row.merchantAmount).minus(1).toFixed(6),
          },
        ],
      });
      expect((await deal(id)).status).toBe('dispute');
      expect((await merchantRow()).balance.toFixed(6)).toBe('1.000000');
      expect(await merchantOps(id)).toHaveLength(opsBefore);
      expectFixed(
        (await walletOf(trader)).mainBalance,
        traderBefore.mainBalance,
      );

      await e2e.http
        .post(`/admin/disputes/${disputeId}/accept`)
        .set(bearer(admin))
        .send({ confirmOverdraft: true })
        .expect(200);

      const accepted = await deal(id);
      expect(accepted.status).toBe('success');
      expectFixed(
        (await walletOf(trader)).mainBalance,
        traderBefore.mainBalance.plus(row.traderAmount),
      );
      const leadShare = shares
        .filter((share) => share.leadUserId === lead.user.id)
        .reduce((sum, share) => sum.plus(share.amount), toDecimal(0));
      expectFixed(
        (await walletOf(lead)).mainBalance,
        leadBefore.mainBalance.plus(leadShare),
      );
      const merchantAfter = await merchantRow();
      expectFixed(
        merchantAfter.balance,
        toDecimal(1).minus(row.merchantAmount),
      );
      expectFixed(merchantAfter.escrow, startEscrow);
      const ops = await merchantOps(id);
      expect(ops[ops.length - 1].type).toBe('deal_pay_out');
      expect(ops.filter((op) => op.type === 'deal_pay_out')).toHaveLength(1);
      expect(
        ops
          .reduce(
            (sum, op) => sum.plus(op.escrowAfter).minus(op.escrowBefore),
            toDecimal(0),
          )
          .isZero(),
      ).toBe(true);
      expectFixed(
        ops.reduce((sum, op) => sum.plus(op.amount), toDecimal(0)),
        toDecimal(row.merchantAmount).neg(),
      );
    });

    it('on a canceled pay-out with a trader, rejected: back to canceled, nothing moved', async () => {
      const { id, disputeId } = await canceledPayOutWithTrader('9630');
      const traderBefore = await walletOf(trader);
      const merchantBefore = await merchantRow();
      const opsBefore = (await merchantOps(id)).length;

      await e2e.http
        .post(`/admin/disputes/${disputeId}/reject`)
        .set(bearer(admin))
        .send({ reason: 'выплаты не было' })
        .expect(200);

      expect((await deal(id)).status).toBe('canceled');
      expectFixed(
        (await walletOf(trader)).mainBalance,
        traderBefore.mainBalance,
      );
      expectFixed((await merchantRow()).balance, merchantBefore.balance);
      expectFixed((await merchantRow()).escrow, merchantBefore.escrow);
      expect(await merchantOps(id)).toHaveLength(opsBefore);
    });

    it('settled, canceled by a superadmin, then disputed and accepted: the trader pays once and the merchant is credited again through deal_dispute', async () => {
      const id = await payIn(nextAmount());
      const merchantBeforeDeal = (await merchantRow()).balance;
      await confirmByTrader(id);
      const settled = await deal(id);
      const merchantSettled = (await merchantRow()).balance;
      expectFixed(
        merchantSettled,
        merchantBeforeDeal.plus(settled.merchantAmount),
      );

      await adminPost(id, 'cancel-settled')
        .send({ reason: 'ошибка' })
        .expect(200);
      expectFixed((await merchantRow()).balance, merchantBeforeDeal);
      const traderCanceled = await walletOf(trader);

      await adminPost(id, 'dispute', admin)
        .attach('file', PDF, 'чек.pdf')
        .expect(200);
      expect((await deal(id)).status).toBe('dispute');
      const dispute = await e2e.dataSource
        .getRepository(TransactionDispute)
        .findOneByOrFail({ transactionId: id });

      await e2e.http
        .post(`/admin/disputes/${dispute.id}/accept`)
        .set(bearer(admin))
        .send({})
        .expect(200);

      const accepted = await deal(id);
      expect(accepted.status).toBe('success');
      expectFixed((await merchantRow()).balance, merchantSettled);
      expectFixed(
        (await walletOf(trader)).mainBalance,
        traderCanceled.mainBalance.minus(settled.traderAmount),
      );
      const ops = (await merchantOps(id)).map((op) => op.type);
      expect(ops[ops.length - 1]).toBe('deal_dispute');
      const sums = await journalSums(id);
      expectFixed(sums.trader, toDecimal(settled.traderAmount).neg());
      expectFixed(sums.merchant, settled.merchantAmount);
    });

    it('on an open pay-in: a deferred dispute, the card still offers close and the callback, and an admin close ends it', async () => {
      const id = await payIn(nextAmount(), { callbackUrl: HOOK });

      const opened = await adminPost(id, 'dispute', admin)
        .attach('file', PDF, 'чек.pdf')
        .expect(200);
      expect(opened.body.data.status).toBe('active');
      const dispute = () =>
        e2e.dataSource
          .getRepository(TransactionDispute)
          .findOneByOrFail({ transactionId: id });
      expect((await dispute()).status).toBe('deferred');

      const card = await e2e.http
        .get(`/admin/transactions/${id}`)
        .set(bearer(superadmin))
        .expect(200);
      expect(card.body.data.actions).toEqual(['close', 'send_callback']);

      await adminPost(id, 'close', admin).expect(200);
      expect((await deal(id)).status).toBe('success');
      expect((await dispute()).status).toBe('canceled');
    });
  });

  describe('a callback', () => {
    it('queues one; again while queued is a 409; once delivered, again within a minute is a 429; no address is a 409', async () => {
      await e2e.dataSource.query(
        `UPDATE merchant_callbacks SET status = 'delivered' WHERE status IN ('pending', 'retrying')`,
      );
      const id = await payIn(nextAmount(), { callbackUrl: HOOK });
      expect(await callbacksOf(id)).toEqual([]);

      const sent = await adminPost(id, 'callback', admin).expect(200);
      const rows = await callbacksOf(id);
      expect(rows).toHaveLength(1);
      expect(sent.body.data.id).toBe(rows[0].id);

      const queued = await adminPost(id, 'callback', admin).expect(409);
      expect(queued.body.code).toBe('CALLBACK_QUEUED');

      await e2e.app.get(MerchantCallbackSenderService).run();
      expect(post).toHaveBeenCalledTimes(1);
      expect((await callbacksOf(id))[0].status).toBe('delivered');

      await adminPost(id, 'callback', admin).expect(429);
      expect(await callbacksOf(id)).toHaveLength(1);

      const silent = await payIn(nextAmount());
      const none = await adminPost(silent, 'callback', admin).expect(409);
      expect(none.body.code).toBe('NO_CALLBACK_URL');
      const card = await e2e.http
        .get(`/admin/transactions/${silent}`)
        .set(bearer(admin))
        .expect(200);
      expect(card.body.data.actions).not.toContain('send_callback');
      await adminPost(UNKNOWN, 'callback', admin).expect(404);
    });
  });

  describe('the list', () => {
    it('filters by a status list, a piece of merchantTransactionId and a piece of the card; counters add up; the CSV has the rows', async () => {
      const marker = `zq${Math.random().toString(36).slice(2, 10)}`;
      const active = await payIn(nextAmount(), {
        merchantTransactionId: `order-${marker}-1`,
      });
      const success = await payIn(nextAmount(), {
        merchantTransactionId: `order-${marker}-2`,
      });
      await confirmByTrader(success);
      const list = (query: Record<string, unknown>) =>
        e2e.http
          .get('/admin/transactions')
          .set(bearer(admin))
          .query({ limit: 100, ...query })
          .expect(200);

      const byStatus = await list({ status: ['active', 'success'] });
      const statuses = new Set(
        (byStatus.body.data as { status: string }[]).map((row) => row.status),
      );
      expect(
        [...statuses].every((status) => ['active', 'success'].includes(status)),
      ).toBe(true);
      const ids = (byStatus.body.data as { id: string }[]).map((row) => row.id);
      expect(ids).toEqual(expect.arrayContaining([active, success]));

      const bySearch = await list({ search: marker });
      expect(
        (bySearch.body.data as { id: string }[]).map((row) => row.id).sort(),
      ).toEqual([active, success].sort());
      expect(bySearch.body.meta.total).toBe(2);

      const bySearchAndStatus = await list({
        search: marker,
        status: 'active',
      });
      expect(
        bySearchAndStatus.body.data.map((row: { id: string }) => row.id),
      ).toEqual([active]);

      const byRequisite = await list({
        requisite: CARD.slice(4, 12),
        kind: 'pay_in',
      });
      expect(byRequisite.body.meta.total).toBeGreaterThan(0);
      expect(
        (byRequisite.body.data as { bankDetails: { card: string } }[]).every(
          (row) => row.bankDetails.card === CARD,
        ),
      ).toBe(true);
      expect(
        (byRequisite.body.data as { id: string }[]).map((row) => row.id),
      ).toEqual(expect.arrayContaining([active, success]));

      const byRecipient = await list({ requisite: PAYOUT_CARD.slice(2, 10) });
      expect(byRecipient.body.meta.total).toBeGreaterThan(0);
      expect(
        (byRecipient.body.data as { kind: string }[]).every(
          (row) => row.kind === 'pay_out',
        ),
      ).toBe(true);

      for (const query of [
        {},
        { status: ['active', 'success'] },
        { kind: 'pay_out' },
        { search: marker },
      ]) {
        const page = await list(query);
        const counters = await e2e.http
          .get('/admin/transactions/counters')
          .set(bearer(admin))
          .query(query)
          .expect(200);
        const sum = Object.values(
          counters.body.data.byMethod as Record<string, number>,
        ).reduce((total, count) => total + count, 0);
        expect(sum).toBe(page.body.meta.total);
        expect(counters.body.data.all).toBe(page.body.meta.total);
      }

      const csv = await e2e.http
        .get('/admin/transactions/export')
        .set(bearer(admin))
        .query({ search: marker })
        .expect(200);
      expect(csv.headers['content-type']).toContain('text/csv');
      const lines = csv.text.trim().split(/\r?\n/);
      expect(
        lines[0].startsWith('id,merchantTransactionId,kind,method,status'),
      ).toBe(true);
      expect(lines).toHaveLength(3);
      expect(
        lines
          .slice(1)
          .map((line) => line.split(',')[0])
          .sort(),
      ).toEqual([active, success].sort());
    });
  });

  describe('access', () => {
    const routes: [string, string][] = [
      ['get', '/admin/transactions'],
      ['get', '/admin/transactions/counters'],
      ['get', '/admin/transactions/export'],
      ['get', `/admin/transactions/${UNKNOWN}`],
      ['post', `/admin/transactions/${UNKNOWN}/close`],
      ['post', `/admin/transactions/${UNKNOWN}/amount`],
      ['post', `/admin/transactions/${UNKNOWN}/cancel-settled`],
      ['post', `/admin/transactions/${UNKNOWN}/restore`],
      ['post', `/admin/transactions/${UNKNOWN}/cancel-payout`],
      ['post', `/admin/transactions/${UNKNOWN}/assign`],
      ['post', `/admin/transactions/${UNKNOWN}/dispute`],
      ['post', `/admin/transactions/${UNKNOWN}/callback`],
    ];

    it('401 without a token, 403 for a trader, everywhere', async () => {
      for (const [method, path] of routes) {
        const call = (
          e2e.http as unknown as Record<
            string,
            (path: string) => import('supertest').Test
          >
        )[method](path);
        await call.expect(401);
        const asTrader = (
          e2e.http as unknown as Record<
            string,
            (path: string) => import('supertest').Test
          >
        )[method](path);
        await asTrader.set(bearer(trader)).expect(403);
      }
    });

    it('an unknown deal is a 404 for the actions', async () => {
      await adminPost(UNKNOWN, 'close', admin).expect(404);
      await adminPost(UNKNOWN, 'cancel-payout', admin).send({}).expect(404);
      await adminPost(UNKNOWN, 'restore').send({ reason: 'x' }).expect(404);
    });
  });
});
