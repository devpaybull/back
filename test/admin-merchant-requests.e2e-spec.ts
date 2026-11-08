import { Role } from '../src/common/enums/role.enum';
import { maskIp } from '../src/common/utils/mask-ip';
import { toCrypto } from '../src/common/utils/to-crypto';
import { Counterparty } from '../src/counterparties/entities/counterparty.entity';
import { Device } from '../src/devices/entities/device.entity';
import { MerchantApiRequest } from '../src/merchant-requests/entities/merchant-api-request.entity';
import { MerchantMethod } from '../src/merchants/entities/merchant-method.entity';
import { MerchantsService } from '../src/merchants/services/merchants.service';
import { CounterpartyDealStatsService } from '../src/transactions/services/counterparty-deal-stats.service';
import { User } from '../src/users/entities/user.entity';
import { TraderSettings } from '../src/trader-settings/entities/trader-settings.entity';
import { MethodRate } from '../src/transactions/entities/method-rate.entity';
import { Wallet } from '../src/transactions/entities/wallet.entity';
import { RateScope } from '../src/transactions/types/rate-scope.enum';
import { deviceOf } from './support/device-of';
import { E2eContext, E2eUser, startE2e } from './support/e2e-app';
import { bearer } from './support/flow';

describe('the admin request history (RH)', () => {
  let e2e: E2eContext;
  let admin: E2eUser;
  let superadmin: E2eUser;
  let trader: E2eUser;
  let merchantId: string;
  let otherMerchantId: string;
  let key: string;
  let bankId: number;
  let created: { requestId: string; dealId: string; orderId: string };
  let refused: { requestId: string; orderId: string };
  let read: string;

  const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

  const payIn = (body: Record<string, unknown>) =>
    e2e.http.post('/v1/payment/pay-in').set('X-Secure-Key', key).send(body);

  const get = (path: string, user: E2eUser = admin) =>
    e2e.http.get(path).set(bearer(user));

  const listIds = async (query = ''): Promise<string[]> =>
    (
      (await get(`/admin/merchant-requests${query}`).expect(200)).body.data as {
        id: string;
      }[]
    ).map((row) => row.id);

  beforeAll(async () => {
    e2e = await startE2e();
    admin = await e2e.createUser(Role.Admin);
    superadmin = await e2e.createUser(Role.Superadmin);
    const merchants = e2e.app.get(MerchantsService);
    merchantId = (await merchants.create('Casino')).id;
    otherMerchantId = (await merchants.create('Bingo')).id;
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

    trader = await e2e.createUser(Role.Trader);
    await e2e.dataSource
      .getRepository(User)
      .update(trader.user.id, { telegramUsername: 'super_maks' });
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
      .expect(201);

    const ok = await payIn({
      method: 'sbp',
      amount: 2000,
      bank: 'tbank',
      merchantTransactionId: 'order-ok',
      payerInfo: { userId: '4214', ip: '203.0.113.7' },
      callbackUrl: 'https://merchant.example/callback',
    }).expect(201);
    created = {
      requestId: ok.headers['x-request-id'],
      dealId: ok.body.data.id,
      orderId: 'order-ok',
    };

    const no = await payIn({
      method: 'sbp',
      amount: '2000000',
      merchantTransactionId: 'order-refused',
      payerInfo: { userId: '4215' },
    }).expect(403);
    refused = {
      requestId: no.headers['x-request-id'],
      orderId: 'order-refused',
    };

    read = (
      await e2e.http
        .get('/v1/merchant/balance')
        .set('X-Secure-Key', key)
        .expect(200)
    ).headers['x-request-id'];

    await settle();
  });

  afterAll(async () => {
    await settle();
    await e2e.close();
  });

  it('is closed to everyone but admin and superadmin', async () => {
    await get('/admin/merchant-requests', trader).expect(403);
    await e2e.http.get('/admin/merchant-requests').expect(401);
    await get('/admin/merchant-requests', superadmin).expect(200);
  });

  it('lists every logged /v1 request newest first, the creation rows composed', async () => {
    const response = await get('/admin/merchant-requests').expect(200);

    expect(response.body.meta).toEqual({
      total: 3,
      page: 1,
      limit: 20,
      pages: 1,
    });
    expect(response.body.data.map((row: { id: string }) => row.id)).toEqual([
      read,
      refused.requestId,
      created.requestId,
    ]);
    expect(response.body.data[2]).toEqual({
      id: created.requestId,
      receivedAt: expect.any(String),
      merchant: { id: merchantId, name: 'Casino' },
      operation: 'pay_in_create',
      direction: 'pay_in',
      method: 'sbp',
      amount: '2000.00',
      currency: 'RUB',
      bank: { id: bankId, code: 'tbank', name: 'Т-банк' },
      payerUserId: '4214',
      counterpartyId: expect.any(Number),
      merchantTransactionId: 'order-ok',
      result: 'created',
      statusCode: 201,
      errorCode: null,
      processedBy: { id: trader.user.id, login: 'super_maks' },
      durationMs: expect.any(Number),
      transactionId: created.dealId,
    });
    expect(response.body.data[1]).toMatchObject({
      result: 'not_created',
      statusCode: 403,
      errorCode: 'NO_REQUISITE_FOUND_FOR_THIS_AMOUNT',
      bank: null,
      processedBy: null,
      transactionId: null,
    });
    expect(response.body.data[0]).toMatchObject({
      operation: null,
      result: 'ok',
      amount: null,
      counterpartyId: null,
    });

    const clients = e2e.dataSource.getRepository(Counterparty);
    expect(response.body.data[2].counterpartyId).toBe(
      (await clients.findOneByOrFail({ merchantId, externalId: '4214' })).id,
    );
    expect(response.body.data[1].counterpartyId).toBe(
      (await clients.findOneByOrFail({ merchantId, externalId: '4215' })).id,
    );
  });

  it('filters by the tab, the operation, the bank, the amount, the merchant and the period', async () => {
    expect(await listIds('?result=created')).toEqual([created.requestId]);
    expect(await listIds('?result=not_created')).toEqual([refused.requestId]);
    expect(await listIds('?operation=pay_in_create')).toEqual([
      refused.requestId,
      created.requestId,
    ]);
    expect(await listIds(`?bankId=${bankId}`)).toEqual([created.requestId]);
    expect(await listIds('?bankId=any&operation=pay_in_create')).toEqual([
      refused.requestId,
    ]);
    expect(await listIds('?amountFrom=100000')).toEqual([refused.requestId]);
    expect(await listIds('?amountTo=2000')).toEqual([created.requestId]);
    expect(await listIds('?direction=pay_out')).toEqual([]);
    expect(await listIds('?method=card')).toEqual([]);
    expect(await listIds(`?merchantId=${otherMerchantId}`)).toEqual([]);
    expect(await listIds('?period=today')).toHaveLength(3);
    expect(await listIds('?period=yesterday')).toEqual([]);
  });

  it('searches the request id, the deal id, the merchantTransactionId and the merchant name', async () => {
    expect(await listIds(`?search=${created.requestId}`)).toEqual([
      created.requestId,
    ]);
    expect(await listIds(`?search=${created.dealId}`)).toEqual([
      created.requestId,
    ]);
    expect(await listIds('?search=order-refused')).toEqual([refused.requestId]);
    expect(await listIds('?search=order')).toEqual([]);
    expect(await listIds('?search=casi')).toHaveLength(3);
    expect(await listIds('?search=bingo')).toEqual([]);
  });

  it('sorts by amount, payer and merchant, and pages', async () => {
    expect(await listIds('?sortBy=amount&operation=pay_in_create')).toEqual([
      refused.requestId,
      created.requestId,
    ]);
    expect(await listIds('?sortBy=payerUserId&sortOrder=asc')).toEqual([
      read,
      created.requestId,
      refused.requestId,
    ]);
    expect(await listIds('?sortBy=merchant&sortOrder=asc')).toEqual([
      created.requestId,
      refused.requestId,
      read,
    ]);

    const second = await get('/admin/merchant-requests?limit=2&page=2').expect(
      200,
    );
    expect(second.body.data.map((row: { id: string }) => row.id)).toEqual([
      created.requestId,
    ]);
    expect(second.body.meta).toEqual({ total: 3, page: 2, limit: 2, pages: 2 });
  });

  it('refuses a bad query with a 400', async () => {
    await get('/admin/merchant-requests?limit=101').expect(400);
    await get('/admin/merchant-requests?sortBy=path').expect(400);
    await get('/admin/merchant-requests?result=ok').expect(400);
    await get('/admin/merchant-requests?bankId=all').expect(400);
    await get('/admin/merchant-requests?amountFrom=2000.505').expect(400);
    await get(
      '/admin/merchant-requests?period=today&periodFrom=2026-11-01&periodTo=2026-11-02',
    ).expect(400);
    await get('/admin/merchant-requests?periodFrom=2026-11-01').expect(400);
  });

  it('counts the tabs under the filters, the result filter aside', async () => {
    expect(
      (await get('/admin/merchant-requests/counters').expect(200)).body.data,
    ).toEqual({ all: 3, created: 1, notCreated: 1 });
    expect(
      (
        await get(
          '/admin/merchant-requests/counters?operation=pay_in_create&result=created',
        ).expect(200)
      ).body.data,
    ).toEqual({ all: 2, created: 1, notCreated: 1 });
  });

  it('shows the card: headers with the key masked, the raw body, the answer, the summary and sizes', async () => {
    const card = (
      await get(
        `/admin/merchant-requests/${created.requestId}`,
        superadmin,
      ).expect(200)
    ).body.data;

    expect(card).toMatchObject({
      id: created.requestId,
      counterpartyId: expect.any(Number),
      httpMethod: 'POST',
      path: '/v1/payment/pay-in',
      statusCode: 201,
      requestBodyTruncated: false,
      responseBodyTruncated: false,
      selectionSummary: expect.objectContaining({ attempted: 1 }),
    });
    expect(card.requestHeaders['x-secure-key']).toBe(
      `${key.slice(0, 4)}…${key.slice(-4)}`,
    );
    expect(JSON.stringify(card)).not.toContain(key);
    expect(JSON.parse(card.requestBody)).toMatchObject({
      amount: 2000,
      callbackUrl: 'https://merchant.example/callback',
    });
    expect(JSON.parse(card.responseBody).data.id).toBe(created.dealId);
    expect(card.sizes.body).toEqual({
      sizeBytes: Buffer.byteLength(card.requestBody),
      lines: 1,
    });
    expect(card.sizes.headers.lines).toBeGreaterThan(2);
  });

  it('shows the client address whole to a superadmin and masked to an admin', async () => {
    const stored = await e2e.dataSource
      .getRepository(MerchantApiRequest)
      .findOneByOrFail({ id: created.requestId });

    expect(
      (
        await get(
          `/admin/merchant-requests/${created.requestId}`,
          superadmin,
        ).expect(200)
      ).body.data.ip,
    ).toBe(stored.ip);
    expect(
      (await get(`/admin/merchant-requests/${created.requestId}`).expect(200))
        .body.data.ip,
    ).toBe(maskIp(stored.ip as string));
    expect(maskIp(stored.ip as string)).not.toBe(stored.ip);
  });

  it('answers 404 for an unknown request and 400 for a malformed id', async () => {
    await get(`/admin/merchant-requests/${trader.user.id}`).expect(404);
    await get('/admin/merchant-requests/not-a-uuid').expect(400);
  });

  it('exports the filtered log as CSV, newest first', async () => {
    const response = await get(
      '/admin/merchant-requests/export?operation=pay_in_create',
    ).expect(200);
    const lines = (response.text as string).split('\r\n');

    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="merchant-requests.csv"',
    );
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain(refused.requestId);
    expect(lines[2]).toContain(
      `${created.requestId},${merchantId},Casino,pay_in_create`,
    );
    expect(lines[2]).toContain('super_maks');
    expect(lines[0]).toContain('payerUserId,counterpartyId,');
    expect(response.text).not.toContain('x-secure-key');
  });

  describe('the counterparty side (AC-RH.8)', () => {
    let early: string;

    const clientOf = (externalId: string) =>
      e2e.dataSource
        .getRepository(Counterparty)
        .findOneByOrFail({ merchantId, externalId });

    const cardOf = async (id: number) =>
      (await get(`/admin/counterparties/${id}`).expect(200)).body.data;

    beforeAll(async () => {
      early = (
        await payIn({
          method: 'crypto',
          amount: '2000',
          merchantTransactionId: 'order-early',
          payerInfo: { userId: '4214' },
        })
          .set('Proxy-Authorization', 'Basic dTpw')
          .expect(400)
      ).headers['x-request-id'];
      await settle();
    });

    it('stores no counterparty on a request refused before the counterparty lookup, and drops Proxy-Authorization', async () => {
      const card = (
        await get(`/admin/merchant-requests/${early}`, superadmin).expect(200)
      ).body.data;

      expect(card.counterpartyId).toBeNull();
      expect(card.errorCode).toBe('METHOD_NOT_SUPPORTED');
      expect(Object.keys(card.requestHeaders)).not.toContain(
        'proxy-authorization',
      );
    });

    it('counts only the requests that reached the counterparty lookup, refusals included, with the last one as «Последний вход»', async () => {
      const paying = await clientOf('4214');
      const refusedClient = await clientOf('4215');
      const createdRow = await e2e.dataSource
        .getRepository(MerchantApiRequest)
        .findOneByOrFail({ id: created.requestId });

      expect(await cardOf(paying.id)).toMatchObject({
        requestCount: 1,
        lastLoginAt: createdRow.receivedAt.toISOString(),
      });
      expect((await cardOf(refusedClient.id)).requestCount).toBe(1);
    });

    it('filters the list by the requests of the last 30 days', async () => {
      const ids = async (query: string) =>
        (
          (
            await get(
              `/admin/counterparties?merchantId=${merchantId}${query}`,
            ).expect(200)
          ).body.data as { id: number }[]
        ).map((row) => row.id);

      expect(await ids('&requests30dFrom=1')).toHaveLength(2);
      expect(await ids('&requests30dFrom=2')).toEqual([]);
      expect(await ids('&requests30dTo=0')).toEqual([]);
    });

    it('fills the funnel’s requests, by method too', async () => {
      const paying = await clientOf('4214');
      const stats = (method = '') =>
        get(`/admin/counterparties/${paying.id}/stats${method}`).expect(200);

      expect((await stats()).body.data.funnel.requests).toBe(1);
      expect((await stats('?method=sbp')).body.data.funnel.requests).toBe(1);
      expect((await stats('?method=card')).body.data.funnel.requests).toBe(0);
    });

    it('shows each creation request in the deal events, by time with the status changes', async () => {
      const paying = await clientOf('4214');
      const events = (
        await get(`/admin/counterparties/${paying.id}/deal-events`).expect(200)
      ).body;
      const requests = events.data.filter(
        (event: { kind: string }) => event.kind === 'deal_requested',
      );

      expect(requests).toEqual([
        expect.objectContaining({
          id: null,
          deal: null,
          trader: expect.objectContaining({ login: 'super_maks' }),
          request: expect.objectContaining({
            id: created.requestId,
            method: 'sbp',
            amountFiat: '2000.00',
            result: 'created',
            statusCode: 201,
            dealId: created.dealId,
          }),
        }),
      ]);
      expect(events.meta.total).toBe(events.data.length);
      expect(
        events.data.map((event: { createdAt: string }) => event.createdAt),
      ).toEqual(
        [...events.data.map((event: { createdAt: string }) => event.createdAt)]
          .sort()
          .reverse(),
      );
    });

    it('rebuilds the same request counters from the log', async () => {
      const paying = await clientOf('4214');
      const before = await cardOf(paying.id);

      await e2e.dataSource.query(
        `UPDATE counterparties SET "requestCount" = 99, "lastRequestAt" = NULL`,
      );
      await e2e.app
        .get(CounterpartyDealStatsService)
        .rebuildCounterpartyStats();

      const after = await cardOf(paying.id);
      expect(after.requestCount).toBe(before.requestCount);
      expect(after.lastLoginAt).toBe(before.lastLoginAt);
      expect(
        (
          await get(
            `/admin/counterparties?merchantId=${merchantId}&requests30dFrom=1`,
          ).expect(200)
        ).body.meta.total,
      ).toBe(2);
    });
  });
});
