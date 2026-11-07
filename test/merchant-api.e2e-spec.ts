import { isIP } from 'node:net';
import { AuditLog } from '../src/audit/entities/audit-log.entity';
import { Role } from '../src/common/enums/role.enum';
import { toCrypto } from '../src/common/utils/to-crypto';
import { Device } from '../src/devices/entities/device.entity';
import { MerchantApiRequest } from '../src/merchant-requests/entities/merchant-api-request.entity';
import { MerchantIpAddress } from '../src/merchants/entities/merchant-ip-address.entity';
import { MerchantMethod } from '../src/merchants/entities/merchant-method.entity';
import { MerchantsService } from '../src/merchants/services/merchants.service';
import { TraderSettings } from '../src/trader-settings/entities/trader-settings.entity';
import { MerchantBalance } from '../src/transactions/entities/merchant-balance.entity';
import { MethodRate } from '../src/transactions/entities/method-rate.entity';
import { SelectionAttempt } from '../src/transactions/entities/selection-attempt.entity';
import { TransactionStatusEvent } from '../src/transactions/entities/transaction-status-event.entity';
import { Transaction } from '../src/transactions/entities/transaction.entity';
import { Wallet } from '../src/transactions/entities/wallet.entity';
import { DealExpiryService } from '../src/transactions/services/deal-expiry.service';
import { RateScope } from '../src/transactions/types/rate-scope.enum';
import { deviceOf } from './support/device-of';
import { E2eContext, E2eUser, startE2e } from './support/e2e-app';
import { bearer } from './support/flow';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('the merchant API: keys, access and the request log', () => {
  let e2e: E2eContext;
  let superadmin: E2eUser;
  let merchantId: string;

  const balance = (key?: string) => {
    const call = e2e.http.get('/v1/merchant/balance');

    return key === undefined ? call : call.set('X-Secure-Key', key);
  };

  const issueKey = async (): Promise<{ id: number; key: string }> =>
    (
      await e2e.http
        .post(`/admin/merchants/${merchantId}/keys`)
        .set(bearer(superadmin))
        .expect(201)
    ).body.data as { id: number; key: string };

  const loggedRow = (id: string) =>
    e2e.dataSource.getRepository(MerchantApiRequest).findOne({ where: { id } });

  const settle = () => new Promise((resolve) => setTimeout(resolve, 200));

  beforeAll(async () => {
    e2e = await startE2e();
    superadmin = await e2e.createUser(Role.Superadmin);
    merchantId = (await e2e.app.get(MerchantsService).create('Casino')).id;
  });

  afterAll(async () => {
    await settle();
    await e2e.close();
  });

  it('answers 401 INVALID_API_KEY without a key or with an unknown one, and logs nothing', async () => {
    const missing = await balance().expect(401);
    const unknown = await balance('not-a-key').expect(401);

    for (const response of [missing, unknown]) {
      expect(response.body).toEqual({
        statusCode: 401,
        code: 'INVALID_API_KEY',
        message: 'Invalid API key',
      });
      expect(response.headers['x-request-id']).toMatch(UUID);
    }
    await settle();
    expect(await e2e.dataSource.getRepository(MerchantApiRequest).count()).toBe(
      0,
    );
  });

  it('serves the balance for a valid key, with X-Request-Id naming the logged row', async () => {
    const { key } = await issueKey();
    const response = await balance(key).expect(200);

    expect(response.body).toEqual({
      data: { available: '0.000000', escrow: '0.000000', currency: 'USDT' },
    });

    const id = response.headers['x-request-id'];
    expect(id).toMatch(UUID);
    await settle();
    const row = await loggedRow(id);
    expect(row).toMatchObject({
      merchantId,
      method: 'GET',
      path: '/v1/merchant/balance',
      statusCode: 200,
      result: 'ok',
      errorCode: null,
      responseBody: JSON.stringify(response.body),
    });
    expect(isIP(row!.ip!)).not.toBe(0);
    expect(row!.requestHeaders['x-secure-key']).toBe(
      `${key.slice(0, 4)}…${key.slice(-4)}`,
    );
    expect(JSON.stringify(row)).not.toContain(key);
  });

  it('keeps one active key: issuing a new one revokes the old, and a revoked key is a 401', async () => {
    const first = await issueKey();
    const second = await issueKey();

    await balance(first.key).expect(401);
    await balance(second.key).expect(200);

    const keys = await e2e.http
      .get(`/admin/merchants/${merchantId}/keys`)
      .set(bearer(superadmin))
      .expect(200);
    expect(
      (keys.body.data as { active: boolean }[]).filter((row) => row.active),
    ).toHaveLength(1);

    await e2e.http
      .post(`/admin/merchants/${merchantId}/keys/${second.id}/revoke`)
      .set(bearer(superadmin))
      .expect(200);
    const revoked = await balance(second.key).expect(401);
    expect(revoked.body.code).toBe('INVALID_API_KEY');
  });

  it('refuses a disabled merchant with 403 MERCHANT_DISABLED and logs the request', async () => {
    const { key } = await issueKey();

    await e2e.http
      .patch(`/admin/merchants/${merchantId}`)
      .set(bearer(superadmin))
      .send({ active: false })
      .expect(200);

    const response = await balance(key).expect(403);
    expect(response.body).toEqual({
      statusCode: 403,
      code: 'MERCHANT_DISABLED',
      message: 'The merchant is disabled',
    });
    await settle();
    expect(await loggedRow(response.headers['x-request-id'])).toMatchObject({
      merchantId,
      statusCode: 403,
      result: 'error',
      errorCode: 'MERCHANT_DISABLED',
    });

    await e2e.http
      .patch(`/admin/merchants/${merchantId}`)
      .set(bearer(superadmin))
      .send({ active: true })
      .expect(200);
    await balance(key).expect(200);
  });

  it('refuses an address off the whitelist with 403 IP_NOT_ALLOWED and logs it, then admits a listed one', async () => {
    const { key } = await issueKey();

    await e2e.http
      .post(`/admin/merchants/${merchantId}/ip-addresses`)
      .set(bearer(superadmin))
      .send({ ip: '198.51.100.1' })
      .expect(201);
    await e2e.http
      .patch(`/admin/merchants/${merchantId}/settings`)
      .set(bearer(superadmin))
      .send({ ipCheckEnabled: true })
      .expect(200);

    const response = await balance(key).expect(403);
    expect(response.body.code).toBe('IP_NOT_ALLOWED');
    await settle();
    expect(await loggedRow(response.headers['x-request-id'])).toMatchObject({
      statusCode: 403,
      errorCode: 'IP_NOT_ALLOWED',
    });

    await e2e.http
      .post(`/admin/merchants/${merchantId}/ip-addresses`)
      .set(bearer(superadmin))
      .send({ ip: '127.0.0.1' })
      .expect(201);
    await balance(key).expect(200);
  });

  it('does not open /v1 with a JWT', async () => {
    const response = await e2e.http
      .get('/v1/merchant/balance')
      .set(bearer(superadmin))
      .expect(401);

    expect(response.body.code).toBe('INVALID_API_KEY');
  });

  describe('POST /v1/payment/pay-in', () => {
    let key: string;
    let trader: E2eUser;
    let requisiteId: string;

    const payIn = (body: Record<string, unknown>) =>
      e2e.http.post('/v1/payment/pay-in').set('X-Secure-Key', key).send(body);

    const body = (overrides: Record<string, unknown> = {}) => ({
      method: 'sbp',
      amount: '2000',
      merchantTransactionId: `order-${Math.random().toString(36).slice(2)}`,
      payerInfo: { userId: 'client-1', ip: '203.0.113.7' },
      ...overrides,
    });

    const dealsWithKey = (merchantTransactionId: string) =>
      e2e.dataSource
        .getRepository(Transaction)
        .find({ where: { merchantId, merchantTransactionId } });

    beforeAll(async () => {
      key = (await issueKey()).key;
      const admin = await e2e.createUser(Role.Admin);
      const country = await e2e.http
        .post('/admin/countries')
        .set(bearer(admin))
        .send({ name: 'Россия' })
        .expect(201);
      const currency = await e2e.http
        .post('/admin/currencies')
        .set(bearer(admin))
        .send({
          name: 'Рубль',
          isocode: 'RUB',
          countryId: country.body.data.id,
        })
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
      const deviceId = await deviceOf(e2e, trader);
      await e2e.dataSource
        .getRepository(Device)
        .update(deviceId, { lastActivity: new Date(Date.now() + 3_600_000) });
      await e2e.dataSource
        .getRepository(TraderSettings)
        .save({ userId: trader.user.id, tradingEnabled: true });
      await e2e.dataSource.getRepository(Wallet).save({
        userId: trader.user.id,
        mainBalance: toCrypto(100000),
        insurancePayInBalance: toCrypto(1000),
      });
      requisiteId = (
        await e2e.http
          .post('/trader/requisites')
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

    afterEach(() =>
      e2e.dataSource.query(
        `UPDATE transactions SET status = 'canceled' WHERE status = 'active'`,
      ),
    );

    it('creates a pay-in: 201 with the requisite, a log row created, the attempt journaled under the request id', async () => {
      const sent = body({ bank: 'tbank' });
      const response = await payIn(sent).expect(201);
      const payment = response.body.data;

      expect(payment).toMatchObject({
        merchantTransactionId: sent.merchantTransactionId,
        type: 'pay_in',
        method: 'sbp',
        status: 'active',
        amount: '2000.00',
        requestedAmount: '2000.00',
        currency: 'RUB',
        rate: '90.900000',
        requisite: {
          bank: { code: 'tbank', name: 'Т-банк' },
          type: 'card_or_sbp',
          sbpNumber: '+79010000001',
          ownerName: 'IVAN IVANOV',
        },
        bank: 'tbank',
        payerInfo: { userId: 'client-1', ip: '203.0.113.7' },
        paymentLifetime: expect.any(Number),
        paymentPageUrl: null,
      });
      expect(
        Date.parse(payment.expiresAt) - Date.parse(payment.createdAt),
      ).toBe(payment.paymentLifetime * 60_000);

      const requestId = response.headers['x-request-id'];
      await settle();
      expect(await loggedRow(requestId)).toMatchObject({
        statusCode: 201,
        result: 'created',
        operation: 'pay_in_create',
        direction: 'pay_in',
        paymentMethod: 'sbp',
        currency: 'RUB',
        payerUserId: 'client-1',
        merchantTransactionId: sent.merchantTransactionId,
        transactionId: payment.id,
        processedByUserId: trader.user.id,
        selectionSummary: expect.objectContaining({
          issuedBankDetailsId: requisiteId,
        }),
      });
      expect(
        await e2e.dataSource
          .getRepository(SelectionAttempt)
          .findOne({ where: { transactionId: payment.id } }),
      ).toMatchObject({ requestId, outcome: 'issued' });
    });

    it('answers a repeat of the same body 200 with the same deal, and another body under the key 409 with the deal', async () => {
      const sent = body();
      const created = await payIn(sent).expect(201);
      const repeat = await payIn(sent).expect(200);

      expect(repeat.body.data.id).toBe(created.body.data.id);

      const clash = await payIn({ ...sent, amount: '2100' }).expect(409);
      expect(clash.body).toMatchObject({
        statusCode: 409,
        code: 'DUPLICATE_MERCHANT_TRANSACTION_ID',
        details: { deal: { id: created.body.data.id } },
      });
      expect(await dealsWithKey(sent.merchantTransactionId)).toHaveLength(1);
    });

    it('refuses with 403 NO_REQUISITE_FOUND_FOR_THIS_AMOUNT, logs not_created with the summary, and leaves the key reusable', async () => {
      const sent = body({ amount: '2000000' });
      const refused = await payIn(sent).expect(403);

      expect(refused.body).toMatchObject({
        statusCode: 403,
        code: 'NO_REQUISITE_FOUND_FOR_THIS_AMOUNT',
      });
      await settle();
      expect(await loggedRow(refused.headers['x-request-id'])).toMatchObject({
        result: 'not_created',
        errorCode: 'NO_REQUISITE_FOUND_FOR_THIS_AMOUNT',
        transactionId: null,
        selectionSummary: expect.objectContaining({
          dropped: { daily_amount: 1 },
        }),
      });

      await payIn({ ...sent, amount: '3000' }).expect(201);
    });

    it('takes a JSON number amount by its decimal text: 2000 is fine, 2000.505 is a 400', async () => {
      const ok = await e2e.http
        .post('/v1/payment/pay-in')
        .set('X-Secure-Key', key)
        .set('Content-Type', 'application/json')
        .send(
          `{"method":"sbp","amount":2000,"merchantTransactionId":"num-ok","payerInfo":{"userId":"client-2"}}`,
        )
        .expect(201);
      expect(ok.body.data.amount).toBe('2000.00');

      const refused = await e2e.http
        .post('/v1/payment/pay-in')
        .set('X-Secure-Key', key)
        .set('Content-Type', 'application/json')
        .send(
          `{"method":"sbp","amount":2000.505,"merchantTransactionId":"num-bad","payerInfo":{"userId":"client-2"}}`,
        )
        .expect(400);
      expect(refused.body).toMatchObject({
        code: 'VALIDATION_FAILED',
        details: [{ field: 'amount', code: 'isFiatAmount' }],
      });
    });

    it('refuses a blacklisted payer with 403 PAYER_BLOCKED', async () => {
      await payIn(body({ payerInfo: { userId: 'bad-client' } })).expect(201);
      await e2e.dataSource.query(
        `UPDATE counterparties SET enabled = false, "blacklistedAt" = now() WHERE "externalId" = 'bad-client'`,
      );

      const refused = await payIn(
        body({ amount: '2200', payerInfo: { userId: 'bad-client' } }),
      ).expect(403);
      expect(refused.body.code).toBe('PAYER_BLOCKED');
    });

    it('gives two parallel identical requests one deal', async () => {
      const sent = body({ amount: '2300', payerInfo: { userId: 'client-3' } });
      const responses = await Promise.all([payIn(sent), payIn(sent)]);

      expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
      expect(responses[0].body.data.id).toBe(responses[1].body.data.id);
      expect(await dealsWithKey(sent.merchantTransactionId)).toHaveLength(1);
    });

    it('refuses an unknown method, a switched-off one, an unknown bank and counteragent with their codes', async () => {
      expect((await payIn(body({ method: 'qr' })).expect(400)).body.code).toBe(
        'METHOD_NOT_SUPPORTED',
      );
      expect(
        (await payIn(body({ method: 'card' })).expect(403)).body.code,
      ).toBe('METHOD_DISABLED');
      expect(
        (await payIn(body({ bank: 'nobank' })).expect(400)).body.code,
      ).toBe('BANK_NOT_FOUND');
      expect(
        (await payIn(body({ counteragent: true })).expect(400)).body.code,
      ).toBe('VALIDATION_FAILED');
    });

    describe('reading, canceling and extending (MA06)', () => {
      const get = (path: string, withKey = key) =>
        e2e.http.get(`/v1/payment${path}`).set('X-Secure-Key', withKey);
      const post = (path: string) =>
        e2e.http.post(`/v1/payment${path}`).set('X-Secure-Key', key);
      const reservedOf = async () =>
        (
          await e2e.dataSource
            .getRepository(Wallet)
            .findOneByOrFail({ userId: trader.user.id })
        ).mainReserved.toFixed(6);

      it('reads a deal by id and by merchantTransactionId; another merchant’s, a missing one and a non-uuid are 404 DEAL_NOT_FOUND', async () => {
        const sent = body({ amount: '2400', payerInfo: { userId: 'reader' } });
        const created = (await payIn(sent).expect(201)).body.data;

        const byId = await get(`/${created.id}`).expect(200);
        expect(byId.body.data).toEqual(created);
        const byKey = await get(
          `/merchant/${sent.merchantTransactionId}`,
        ).expect(200);
        expect(byKey.body.data).toEqual(created);

        const otherId = (
          await e2e.app.get(MerchantsService).create('Other casino')
        ).id;
        const otherKey = (
          await e2e.http
            .post(`/admin/merchants/${otherId}/keys`)
            .set(bearer(superadmin))
            .expect(201)
        ).body.data.key as string;

        for (const response of [
          await get(`/${created.id}`, otherKey).expect(404),
          await get(`/merchant/${sent.merchantTransactionId}`, otherKey).expect(
            404,
          ),
          await get('/00000000-0000-4000-8000-000000000000').expect(404),
          await get('/not-a-uuid').expect(404),
          await get('/merchant/no-such-order').expect(404),
          await post(`/${created.id}/cancel`)
            .set('X-Secure-Key', otherKey)
            .expect(404),
        ]) {
          expect(response.body).toMatchObject({
            statusCode: 404,
            code: 'DEAL_NOT_FOUND',
          });
        }
        expect((await get(`/${created.id}`).expect(200)).body.data.status).toBe(
          'active',
        );
      });

      it('lists the merchant’s deals as a page, with status, type, period and search filters', async () => {
        const first = body({ amount: '2500', payerInfo: { userId: 'lister' } });
        const second = body({
          amount: '2600',
          payerInfo: { userId: 'lister' },
        });
        await payIn(first).expect(201);
        await payIn(second).expect(201);

        const today = new Date().toISOString();
        const all = await get(
          `?status=active&type=pay_in&createdFrom=2026-01-01&createdTo=${encodeURIComponent(
            new Date(Date.now() + 60_000).toISOString(),
          )}&sortBy=amount&sortOrder=asc`,
        ).expect(200);
        expect(all.body.meta).toMatchObject({ page: 1, limit: 20 });
        expect(
          all.body.data.map((payment: { amount: string }) => payment.amount),
        ).toEqual(['2500.00', '2600.00']);
        expect(all.body.data[0].requisite).toMatchObject({
          sbpNumber: '+79010000001',
        });

        const found = await get(
          `?search=${second.merchantTransactionId}`,
        ).expect(200);
        expect(found.body.data).toHaveLength(1);
        expect(found.body.data[0].merchantTransactionId).toBe(
          second.merchantTransactionId,
        );
        const byId = await get(`?search=${found.body.data[0].id}`).expect(200);
        expect(byId.body.data.map((p: { id: string }) => p.id)).toEqual([
          found.body.data[0].id,
        ]);

        expect((await get('?type=pay_out').expect(200)).body).toMatchObject({
          data: [],
          meta: { total: 0 },
        });
        expect(
          (
            await get(
              `?createdFrom=${encodeURIComponent(today)}&status=success`,
            ).expect(200)
          ).body.data,
        ).toEqual([]);
        expect((await get('?sortBy=merchant').expect(400)).body.code).toBe(
          'VALIDATION_FAILED',
        );
      });

      it('cancels an active pay-in: 200 canceled, escrow released, event from the merchant, audit row; a repeat answers the same', async () => {
        const reservedBefore = await reservedOf();
        const created = (
          await payIn(
            body({ amount: '2700', payerInfo: { userId: 'canceler' } }),
          ).expect(201)
        ).body.data;
        expect(await reservedOf()).not.toBe(reservedBefore);

        const canceled = await post(`/${created.id}/cancel`).expect(200);
        expect(canceled.body.data).toMatchObject({
          id: created.id,
          status: 'canceled',
          resolvedAt: expect.any(String),
        });
        expect(await reservedOf()).toBe(reservedBefore);

        const repeat = await post(`/${created.id}/cancel`).expect(200);
        expect(repeat.body.data).toEqual(canceled.body.data);
        expect(await reservedOf()).toBe(reservedBefore);

        expect(
          await e2e.dataSource.getRepository(TransactionStatusEvent).findOne({
            where: { transactionId: created.id, toStatus: 'canceled' as never },
          }),
        ).toMatchObject({
          source: 'merchant',
          actorUserId: null,
          reason: 'merchant_canceled',
        });
        const audits = await e2e.dataSource
          .getRepository(AuditLog)
          .find({ where: { action: 'merchant_api.deal_canceled' } });
        expect(
          audits.filter((row) => row.metadata?.transactionId === created.id),
        ).toEqual([
          expect.objectContaining({
            actorUserId: null,
            metadata: {
              merchantId,
              transactionId: created.id,
              fromStatus: 'active',
            },
          }),
        ]);
      });

      it('refuses to cancel a deal past active with 409 DEAL_NOT_CANCELABLE', async () => {
        const created = (
          await payIn(
            body({ amount: '2800', payerInfo: { userId: 'checker' } }),
          ).expect(201)
        ).body.data;
        await e2e.dataSource
          .getRepository(Transaction)
          .update(created.id, { status: 'checking' as never });

        const refused = await post(`/${created.id}/cancel`).expect(409);
        expect(refused.body).toMatchObject({
          statusCode: 409,
          code: 'DEAL_NOT_CANCELABLE',
        });
        expect((await get(`/${created.id}`).expect(200)).body.data.status).toBe(
          'checking',
        );
      });

      it('extends the timer once by the original window; the second time is 409 TIMER_NOT_EXTENDABLE', async () => {
        const created = (
          await payIn(
            body({ amount: '2900', payerInfo: { userId: 'extender' } }),
          ).expect(201)
        ).body.data;
        const window =
          Date.parse(created.expiresAt) - Date.parse(created.createdAt);

        const extended = await post(`/${created.id}/extend-timer`).expect(200);
        expect(Date.parse(extended.body.data.expiresAt)).toBe(
          Date.parse(created.expiresAt) + window,
        );
        expect(
          (
            await e2e.dataSource
              .getRepository(Transaction)
              .findOneByOrFail({ id: created.id })
          ).timerExtendedAt,
        ).toBeInstanceOf(Date);
        expect(
          await e2e.dataSource.getRepository(AuditLog).count({
            where: { action: 'merchant_api.timer_extended' },
          }),
        ).toBe(1);

        const again = await post(`/${created.id}/extend-timer`).expect(409);
        expect(again.body).toMatchObject({
          statusCode: 409,
          code: 'TIMER_NOT_EXTENDABLE',
        });
        expect(
          (await get(`/${created.id}`).expect(200)).body.data.expiresAt,
        ).toBe(extended.body.data.expiresAt);
      });
    });

    describe('POST /v1/payment/pay-out (MA05)', () => {
      const CARD = '4111111111111111';

      const payOut = (sent: Record<string, unknown>) =>
        e2e.http
          .post('/v1/payment/pay-out')
          .set('X-Secure-Key', key)
          .send(sent);

      const payOutBody = (overrides: Record<string, unknown> = {}) => ({
        method: 'card',
        amount: '9090',
        merchantTransactionId: `payout-${Math.random().toString(36).slice(2)}`,
        requisite: {
          ownerName: 'PETR PETROV',
          bank: 'tbank',
          cardNumber: CARD,
        },
        ...overrides,
      });

      const merchantBalance = async () => {
        const row = await e2e.dataSource
          .getRepository(MerchantBalance)
          .findOneByOrFail({ merchantId });

        return {
          available: row.balance.toFixed(6),
          escrow: row.escrow.toFixed(6),
        };
      };

      const fundMerchant = async (amount: number) => {
        const repository = e2e.dataSource.getRepository(MerchantBalance);
        const row = await repository.findOneBy({ merchantId });

        await repository.save({
          ...(row ?? { merchantId }),
          balance: toCrypto(amount),
          escrow: toCrypto(0),
        });
      };

      beforeAll(async () => {
        await e2e.dataSource.getRepository(MethodRate).save({
          scope: RateScope.Merchant,
          method: 'card',
          payInPercent: 0,
          payOutPercent: 2,
        });
        await e2e.dataSource.getRepository(MerchantMethod).save({
          merchantId,
          method: 'card',
          payInEnabled: false,
          payOutEnabled: true,
        });
      });

      beforeEach(async () => {
        await e2e.dataSource.query(
          `UPDATE transactions SET status = 'canceled' WHERE kind = 'pay_out' AND status = 'pending'`,
        );
        await fundMerchant(1000);
      });

      it('creates a pending pay-out with no trader: 201, the recipient whole, the merchant amount held, a log row created', async () => {
        const sent = payOutBody({ timeoutInMin: 30 });
        const response = await payOut(sent).expect(201);
        const payment = response.body.data;

        expect(payment).toMatchObject({
          merchantTransactionId: sent.merchantTransactionId,
          type: 'pay_out',
          method: 'card',
          status: 'pending',
          amount: '9090.00',
          currency: 'RUB',
          rate: '90.900000',
          crypto: '100.000000',
          fee: '2.000000',
          merchantAmount: '102.000000',
          requisite: {
            bank: { code: 'tbank', name: 'Т-банк' },
            cardNumber: CARD,
            sbpNumber: null,
            ownerName: 'PETR PETROV',
          },
          paymentLifetime: 30,
        });
        expect(await merchantBalance()).toEqual({
          available: '898.000000',
          escrow: '102.000000',
        });

        const stored = await e2e.dataSource
          .getRepository(Transaction)
          .findOneByOrFail({ id: payment.id });
        expect(stored).toMatchObject({
          traderUserId: null,
          bankDetailsId: null,
          traderPercent: null,
          traderAmount: null,
          traderCommission: null,
          leadPercent: null,
          payoutBankId: expect.any(Number),
        });

        await settle();
        expect(await loggedRow(response.headers['x-request-id'])).toMatchObject(
          {
            statusCode: 201,
            result: 'created',
            operation: 'pay_out_create',
            direction: 'pay_out',
            paymentMethod: 'card',
            currency: 'RUB',
            requestedBankId: stored.payoutBankId,
            merchantTransactionId: sent.merchantTransactionId,
            transactionId: payment.id,
            processedByUserId: null,
          },
        );
      });

      it('answers a repeat 200 with the same deal and holds nothing more; another recipient under the key is 409', async () => {
        const sent = payOutBody();
        const created = await payOut(sent).expect(201);
        const repeat = await payOut(sent).expect(200);

        expect(repeat.body.data.id).toBe(created.body.data.id);
        expect(await merchantBalance()).toEqual({
          available: '898.000000',
          escrow: '102.000000',
        });

        const clash = await payOut({
          ...sent,
          requisite: { ...sent.requisite, cardNumber: '5555555555554444' },
        }).expect(409);
        expect(clash.body).toMatchObject({
          code: 'DUPLICATE_MERCHANT_TRANSACTION_ID',
          details: { deal: { id: created.body.data.id } },
        });
        expect(await dealsWithKey(sent.merchantTransactionId)).toHaveLength(1);
      });

      it('gives two parallel identical requests one deal and one hold', async () => {
        const sent = payOutBody();
        const responses = await Promise.all([payOut(sent), payOut(sent)]);

        expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
        expect(await dealsWithKey(sent.merchantTransactionId)).toHaveLength(1);
        expect((await merchantBalance()).escrow).toBe('102.000000');
      });

      it('refuses a pay-out the balance does not cover with 409 INSUFFICIENT_BALANCE and leaves the key free', async () => {
        await fundMerchant(50);
        const sent = payOutBody();

        const refused = await payOut(sent).expect(409);
        expect(refused.body.code).toBe('INSUFFICIENT_BALANCE');
        expect(await dealsWithKey(sent.merchantTransactionId)).toHaveLength(0);
        expect(await merchantBalance()).toEqual({
          available: '50.000000',
          escrow: '0.000000',
        });

        await fundMerchant(1000);
        await payOut(sent).expect(201);
      });

      it('refuses a method without pay-out, a switched-off one, a mismatched requisite, a bad card and an unknown bank', async () => {
        expect(
          (await payOut(payOutBody({ method: 'counterparty' })).expect(400))
            .body.code,
        ).toBe('METHOD_NOT_SUPPORTED');
        expect(
          (
            await payOut(
              payOutBody({
                method: 'sbp',
                requisite: {
                  ownerName: 'P',
                  bank: 'tbank',
                  sbpNumber: '79001234567',
                },
              }),
            ).expect(403)
          ).body.code,
        ).toBe('METHOD_DISABLED');
        const mismatch = await payOut(
          payOutBody({
            requisite: {
              ownerName: 'P',
              bank: 'tbank',
              sbpNumber: '79001234567',
            },
          }),
        ).expect(400);
        expect(mismatch.body).toMatchObject({
          code: 'VALIDATION_FAILED',
          details: [{ field: 'requisite', code: 'matchesMethod' }],
        });
        expect(
          (
            await payOut(
              payOutBody({
                requisite: {
                  ownerName: 'P',
                  bank: 'tbank',
                  cardNumber: '4111111111111112',
                },
              }),
            ).expect(400)
          ).body.details,
        ).toEqual([{ field: 'requisite.cardNumber', code: 'luhn' }]);
        expect(
          (
            await payOut(
              payOutBody({
                requisite: { ownerName: 'P', bank: 'nobank', cardNumber: CARD },
              }),
            ).expect(400)
          ).body.code,
        ).toBe('BANK_NOT_FOUND');
        expect((await merchantBalance()).escrow).toBe('0.000000');
      });

      it('reads it and cancels it from pending: the hold comes back, and every deal list survives the missing trader', async () => {
        const created = (await payOut(payOutBody()).expect(201)).body.data;

        const read = await e2e.http
          .get(`/v1/payment/${created.id}`)
          .set('X-Secure-Key', key)
          .expect(200);
        expect(read.body.data).toEqual(created);

        const admin = await e2e.createUser(Role.Admin);
        const adminList = await e2e.http
          .get('/admin/transactions?kind=pay_out')
          .set(bearer(admin))
          .expect(200);
        expect(adminList.body.data).toContainEqual(
          expect.objectContaining({
            id: created.id,
            trader: null,
            bankDetails: null,
          }),
        );

        const account = await e2e.createUser(Role.Merchant, { merchantId });
        const cabinetList = await e2e.http
          .get('/merchant/deals')
          .set(bearer(account))
          .expect(200);
        expect(
          cabinetList.body.data.map((row: { id: string }) => row.id),
        ).toContain(created.id);
        await e2e.http
          .get(`/merchant/deals/${created.id}`)
          .set(bearer(account))
          .expect(200);
        await e2e.http
          .get('/merchant/deals/export')
          .set(bearer(account))
          .expect(200);

        const canceled = await e2e.http
          .post(`/v1/payment/${created.id}/cancel`)
          .set('X-Secure-Key', key)
          .expect(200);
        expect(canceled.body.data.status).toBe('canceled');
        expect(await merchantBalance()).toEqual({
          available: '1000.000000',
          escrow: '0.000000',
        });
      });

      it('expires an untaken pay-out: canceled by the timer, the hold back', async () => {
        const created = (
          await payOut(payOutBody({ timeoutInMin: 1 })).expect(201)
        ).body.data;
        expect((await merchantBalance()).escrow).toBe('102.000000');

        await e2e.app
          .get(DealExpiryService)
          .run(new Date(Date.parse(created.expiresAt) + 1000));

        const expired = await e2e.dataSource
          .getRepository(Transaction)
          .findOneByOrFail({ id: created.id });
        expect(expired).toMatchObject({
          status: 'canceled',
          traderUserId: null,
        });
        expect(await merchantBalance()).toEqual({
          available: '1000.000000',
          escrow: '0.000000',
        });
        expect(
          await e2e.dataSource.getRepository(TransactionStatusEvent).findOne({
            where: { transactionId: created.id, toStatus: 'canceled' as never },
          }),
        ).toMatchObject({ source: 'auto_timer', reason: 'expired' });
      });

      it('creates a pay-out from an address off the whitelist, while the rest of /v1 stays closed to it', async () => {
        const addresses = e2e.dataSource.getRepository(MerchantIpAddress);
        const listed = await addresses.find({ where: { merchantId } });
        await addresses.remove(
          listed.filter((row) => row.ip !== '198.51.100.1'),
        );

        expect((await balance(key).expect(403)).body.code).toBe(
          'IP_NOT_ALLOWED',
        );
        await payOut(payOutBody()).expect(201);
      });
    });
  });
});
