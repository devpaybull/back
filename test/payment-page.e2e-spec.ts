import { AuditLog } from '../src/audit/entities/audit-log.entity';
import { Role } from '../src/common/enums/role.enum';
import { toCrypto } from '../src/common/utils/to-crypto';
import { Device } from '../src/devices/entities/device.entity';
import { MerchantCallback } from '../src/merchant-callbacks/entities/merchant-callback.entity';
import { MerchantMethod } from '../src/merchants/entities/merchant-method.entity';
import { MerchantSettings } from '../src/merchants/entities/merchant-settings.entity';
import { MerchantsService } from '../src/merchants/services/merchants.service';
import { TraderSettings } from '../src/trader-settings/entities/trader-settings.entity';
import { MethodRate } from '../src/transactions/entities/method-rate.entity';
import { TransactionFile } from '../src/transactions/entities/transaction-file.entity';
import { TransactionStatusEvent } from '../src/transactions/entities/transaction-status-event.entity';
import { Transaction } from '../src/transactions/entities/transaction.entity';
import { Wallet } from '../src/transactions/entities/wallet.entity';
import { DealExpiryService } from '../src/transactions/services/deal-expiry.service';
import { RateScope } from '../src/transactions/types/rate-scope.enum';
import { deviceOf } from './support/device-of';
import { E2eContext, E2eUser, startE2e } from './support/e2e-app';
import { bearer } from './support/flow';

const PAGE_URL = 'https://pay.example/p';
const RATE_LIMIT = 20;
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n');

describe('the payment page /pay (MA11)', () => {
  let e2e: E2eContext;
  let trader: E2eUser;
  let merchantId: string;
  let key: string;
  let amount = 2000;
  let client = 0;
  let ip = '';

  const payIn = async (
    extra: Record<string, unknown> = {},
  ): Promise<{ id: string; token: string; url: string }> => {
    amount += 1;
    const response = await e2e.http
      .post('/v1/payment/pay-in')
      .set('X-Secure-Key', key)
      .send({
        method: 'sbp',
        amount: String(amount),
        merchantTransactionId: `in-${Math.random().toString(36).slice(2)}`,
        payerInfo: { userId: 'client-1' },
        ...extra,
      })
      .expect(201);
    const url = response.body.data.paymentPageUrl as string;

    return {
      id: response.body.data.id as string,
      url,
      token: url.slice(PAGE_URL.length + 1),
    };
  };

  const page = (token: string) =>
    e2e.http.get(`/pay/${token}`).set('X-Forwarded-For', ip);
  const paid = (token: string) =>
    e2e.http.post(`/pay/${token}/paid`).set('X-Forwarded-For', ip);
  const receipt = (token: string, file = PDF, name = 'чек.pdf') =>
    e2e.http
      .post(`/pay/${token}/receipt`)
      .set('X-Forwarded-For', ip)
      .attach('file', file, name);
  const deal = (id: string) =>
    e2e.dataSource
      .getRepository(Transaction)
      .findOneByOrFail({ id }) as Promise<Transaction>;

  beforeAll(async () => {
    e2e = await startE2e({
      PAYMENT_PAGE_URL: `${PAGE_URL}/`,
      PAY_PAGE_RATE_LIMIT_PER_MINUTE: String(RATE_LIMIT),
    });
    e2e.app.getHttpAdapter().getInstance().set('trust proxy', true);

    const superadmin = await e2e.createUser(Role.Superadmin);
    const admin = await e2e.createUser(Role.Admin);

    merchantId = (await e2e.app.get(MerchantsService).create('Casino')).id;
    key = (
      await e2e.http
        .post(`/admin/merchants/${merchantId}/keys`)
        .set(bearer(superadmin))
        .expect(201)
    ).body.data.key as string;
    await e2e.dataSource.getRepository(MerchantSettings).save({
      merchantId,
      successUrl: 'https://merchant.example/ok',
      errorUrl: 'https://merchant.example/err',
      supportLink: 'https://t.me/casino_support',
    });

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
        dailyAmountLimit: '100000000.00',
      })
      .expect(201);
  });

  beforeEach(() => {
    client += 1;
    ip = `198.51.100.${client}`;
  });

  afterAll(() => e2e.close());

  it('gives a /v1 pay-in a paymentPageUrl with a random token, and the page shows only what the payer needs', async () => {
    const { id, url, token } = await payIn({
      successUrl: 'https://merchant.example/order/ok',
    });

    expect(url).toMatch(
      new RegExp(`^${PAGE_URL.replace(/\./g, '\\.')}/[A-Za-z0-9_-]{43}$`),
    );
    expect(token).not.toContain(id);

    const read = await e2e.http
      .get(`/v1/payment/${id}`)
      .set('X-Secure-Key', key)
      .expect(200);
    expect(read.body.data.paymentPageUrl).toBe(url);

    const response = await page(token).expect(200);

    expect(response.body).toEqual({
      data: {
        amount: `${amount}.00`,
        currency: 'RUB',
        requisite: {
          bank: { code: 'tbank', name: 'Т-банк' },
          type: 'card_or_sbp',
          cardNumber: null,
          sbpNumber: '+79010000001',
          ownerName: 'IVAN IVANOV',
        },
        expiresAt: (await deal(id)).expiresAt!.toISOString(),
        status: 'active',
        successUrl: 'https://merchant.example/order/ok',
        errorUrl: 'https://merchant.example/err',
        supportLink: 'https://t.me/casino_support',
      },
    });
    expect(JSON.stringify(response.body)).not.toContain(id);
    expect(JSON.stringify(response.body)).not.toContain(merchantId);
    expect(JSON.stringify(response.body)).not.toContain(trader.user.id);
  });

  it('answers 404 PAYMENT_PAGE_NOT_FOUND for an unknown and a malformed token, without a key or a JWT', async () => {
    for (const token of ['A'.repeat(43), 'not-a-token']) {
      const response = await page(token).expect(404);

      expect(response.body).toEqual({
        statusCode: 404,
        code: 'PAYMENT_PAGE_NOT_FOUND',
        message: 'Payment page not found',
      });
    }
    await paid('A'.repeat(43)).expect(404);
  });

  it('«Я оплатил» moves the pay-in to checking as the payer, writes the callback and the audit, and a repeat moves nothing', async () => {
    const { id, token } = await payIn();

    const first = await paid(token).expect(200);
    expect(first.body.data.status).toBe('checking');

    const row = await deal(id);
    expect(row.status).toBe('checking');
    expect(row.payerPaidAt).toBeInstanceOf(Date);

    const events = () =>
      e2e.dataSource
        .getRepository(TransactionStatusEvent)
        .find({ where: { transactionId: id }, order: { id: 'ASC' } });
    const history = await events();
    expect(history[history.length - 1]).toMatchObject({
      fromStatus: 'active',
      toStatus: 'checking',
      source: 'payer',
      actorUserId: null,
    });
    expect(
      await e2e.dataSource
        .getRepository(MerchantCallback)
        .find({ where: { transactionId: id } }),
    ).toEqual([
      expect.objectContaining({ event: 'status_changed', eventSeq: 1 }),
    ]);
    expect(
      await e2e.dataSource.getRepository(AuditLog).findOne({
        where: { action: 'payment_page.paid' },
        order: { id: 'DESC' },
      }),
    ).toMatchObject({
      actorUserId: null,
      metadata: { merchantId, transactionId: id },
    });

    const count = (await events()).length;
    const again = await paid(token).expect(200);
    expect(again.body.data.status).toBe('checking');
    expect(await events()).toHaveLength(count);
  });

  it('lets the timer run in checking: at expiresAt the deal goes to checking_manually, and the page still shows it', async () => {
    const { id, token } = await payIn();

    await paid(token).expect(200);
    await e2e.dataSource
      .getRepository(Transaction)
      .update(id, { expiresAt: new Date(Date.now() - 1000) });
    await e2e.app.get(DealExpiryService).run();

    expect((await deal(id)).status).toBe('checking_manually');
    expect((await page(token).expect(200)).body.data.status).toBe(
      'checking_manually',
    );
    await paid(token).expect(200);
  });

  it('refuses «Я оплатил» past the timer with 409 PAYMENT_NOT_PAYABLE', async () => {
    const { id, token } = await payIn();

    await e2e.dataSource
      .getRepository(Transaction)
      .update(id, { expiresAt: new Date(Date.now() - 1000) });

    const response = await paid(token).expect(409);
    expect(response.body).toMatchObject({ code: 'PAYMENT_NOT_PAYABLE' });
    expect((await deal(id)).status).toBe('active');
  });

  it('closes the token at a final status: the trader confirms, and every /pay route is a 404', async () => {
    const { id, token } = await payIn();

    await paid(token).expect(200);
    await e2e.http
      .post(`/trader/deals/${id}/confirm`)
      .set(bearer(trader))
      .expect(200);

    await page(token).expect(404);
    await paid(token).expect(404);
    await receipt(token).expect(404);
  });

  it('takes up to three receipts from the payer, typed by content, and leaves the status alone', async () => {
    const { id, token } = await payIn();

    const typeRefused = await receipt(
      token,
      Buffer.from('plain text'),
      'r.pdf',
    ).expect(400);
    expect(typeRefused.body.code).toBe('FILE_TYPE_NOT_ALLOWED');

    for (let i = 0; i < 3; i++) {
      const response = await receipt(token).expect(201);

      expect(response.body).toEqual({
        data: { name: 'чек.pdf', size: PDF.length, mime: 'application/pdf' },
      });
    }

    const fourth = await receipt(token).expect(409);
    expect(fourth.body).toMatchObject({ code: 'RECEIPT_LIMIT_REACHED' });

    const files = await e2e.dataSource
      .getRepository(TransactionFile)
      .find({ where: { transactionId: id } });
    expect(files).toHaveLength(3);
    expect(
      files.every(
        (file) =>
          file.kind === 'payer_receipt' && file.uploadedByUserId === null,
      ),
    ).toBe(true);
    expect((await deal(id)).status).toBe('active');

    const download = await e2e.http
      .get(`/trader/files/${files[0].id}`)
      .set(bearer(trader))
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(Buffer.compare(download.body as Buffer, PDF)).toBe(0);
  });

  it('limits each client address to the configured requests a minute with 429, other addresses unaffected', async () => {
    const token = 'A'.repeat(43);

    for (let i = 0; i < RATE_LIMIT; i++) await page(token).expect(404);

    const refused = await page(token).expect(429);
    expect(refused.body).toEqual({
      statusCode: 429,
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many requests; try again in a minute',
    });
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    await paid(token).expect(429);

    ip = '198.51.100.250';
    await page(token).expect(404);
  });
});
