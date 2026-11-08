import { createHmac } from 'node:crypto';
import { Role } from '../src/common/enums/role.enum';
import { toCrypto } from '../src/common/utils/to-crypto';
import { Device } from '../src/devices/entities/device.entity';
import { MerchantCallback } from '../src/merchant-callbacks/entities/merchant-callback.entity';
import { MerchantCallbackSenderService } from '../src/merchant-callbacks/services/merchant-callback-sender.service';
import {
  CallbackHttpClient,
  CallbackUrlRefusedError,
} from '../src/merchant-callbacks/types/callback-http-client';
import { MerchantCallbackStatus } from '../src/merchant-callbacks/types/merchant-callback-status.enum';
import { MerchantMethod } from '../src/merchants/entities/merchant-method.entity';
import { MerchantSettings } from '../src/merchants/entities/merchant-settings.entity';
import { MerchantsService } from '../src/merchants/services/merchants.service';
import { TraderSettings } from '../src/trader-settings/entities/trader-settings.entity';
import { MethodRate } from '../src/transactions/entities/method-rate.entity';
import { Wallet } from '../src/transactions/entities/wallet.entity';
import { RateScope } from '../src/transactions/types/rate-scope.enum';
import { deviceOf } from './support/device-of';
import { E2eContext, E2eUser, startE2e } from './support/e2e-app';
import { bearer } from './support/flow';

const HOOK = 'https://merchant.example/hook';
const MINUTE = 60_000;

describe('merchant callbacks', () => {
  let e2e: E2eContext;
  let trader: E2eUser;
  let merchant: E2eUser;
  let support: E2eUser;
  let admin: E2eUser;
  let merchantId: string;
  let key: string;
  let secret: string;
  let post: jest.SpyInstance;

  const rows = (transactionId: string) =>
    e2e.dataSource.getRepository(MerchantCallback).find({
      where: { transactionId },
      order: { eventSeq: 'ASC', createdAt: 'ASC' },
    });
  const send = (at = 0) =>
    e2e.app
      .get(MerchantCallbackSenderService)
      .run(() => new Date(Date.now() + at));
  const answer = (statusCode: number) =>
    post.mockImplementation(async () => ({ statusCode, body: 'ok' }));

  const payIn = async (callbackUrl?: string): Promise<string> =>
    (
      await e2e.http
        .post('/v1/payment/pay-in')
        .set('X-Secure-Key', key)
        .send({
          method: 'sbp',
          amount: '2000',
          merchantTransactionId: `in-${Math.random().toString(36).slice(2)}`,
          payerInfo: { userId: 'client-1', ip: '203.0.113.7' },
          ...(callbackUrl ? { callbackUrl } : {}),
        })
        .expect(201)
    ).body.data.id as string;

  const confirm = (id: string) =>
    e2e.http
      .post(`/trader/deals/${id}/confirm`)
      .set(bearer(trader))
      .expect(200);
  const decline = (id: string) =>
    e2e.http
      .post(`/trader/deals/${id}/decline`)
      .set(bearer(trader))
      .send({ reasonCode: 'limit_reached' })
      .expect(200);

  beforeAll(async () => {
    e2e = await startE2e();
    const superadmin = await e2e.createUser(Role.Superadmin);
    admin = await e2e.createUser(Role.Admin);

    merchantId = (await e2e.app.get(MerchantsService).create('Casino')).id;
    const issued = await e2e.http
      .post(`/admin/merchants/${merchantId}/keys`)
      .set(bearer(superadmin))
      .expect(201);

    key = issued.body.data.key as string;
    secret = issued.body.data.secret as string;
    merchant = await e2e.createUser(Role.Merchant, { merchantId });
    support = await e2e.createUser(Role.MerchantSupport, { merchantId });

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

    post = jest.spyOn(e2e.app.get(CallbackHttpClient), 'post');
  });

  beforeEach(async () => {
    post.mockReset();
    answer(200);
    await e2e.dataSource.query(
      `UPDATE merchant_callbacks SET status = 'delivered' WHERE status IN ('pending', 'retrying')`,
    );
  });

  afterAll(() => e2e?.close());

  it('a confirmed deal sends one signed status_changed with the same PaymentDto the API gives', async () => {
    const id = await payIn(HOOK);

    expect(await rows(id)).toEqual([]);

    await confirm(id);
    await send();

    expect(post).toHaveBeenCalledTimes(1);

    const [url, body, headers] = post.mock.calls[0] as [
      string,
      string,
      Record<string, string>,
    ];
    const sent = JSON.parse(body) as {
      eventId: string;
      eventSeq: number;
      event: string;
      payment: { id: string; status: string; amount: string };
    };

    expect(url).toBe(HOOK);
    expect(sent).toMatchObject({
      eventSeq: 1,
      event: 'status_changed',
      payment: { id, status: 'success', amount: '2000.00' },
    });
    expect(headers['X-Event-Id']).toBe(sent.eventId);
    expect(headers['X-Signature']).toBe(
      createHmac('sha256', secret)
        .update(`${headers['X-Timestamp']}.${body}`)
        .digest('hex'),
    );

    const api = await e2e.http
      .get(`/v1/payment/${id}`)
      .set('X-Secure-Key', key)
      .expect(200);
    expect(sent.payment).toEqual(JSON.parse(JSON.stringify(api.body.data)));

    const [row] = await rows(id);
    expect(row).toMatchObject({
      status: 'delivered',
      attempts: 1,
      lastResponseCode: 200,
      lastResponseBody: 'ok',
    });
  });

  it('falls back to the merchant’s URL; with neither the row is skipped and nothing is sent', async () => {
    const settings = e2e.dataSource.getRepository(MerchantSettings);
    const none = await payIn();

    await confirm(none);
    expect((await rows(none))[0].status).toBe('skipped');
    await send();
    expect(post).not.toHaveBeenCalled();

    await e2e.http
      .patch(`/admin/merchants/${merchantId}/settings`)
      .set(bearer(admin))
      .send({ callbackUrl: 'https://merchant.example/settings-hook' })
      .expect(200);

    try {
      const fallback = await payIn();

      await confirm(fallback);
      await send();
      expect(post.mock.calls[0][0]).toBe(
        'https://merchant.example/settings-hook',
      );
    } finally {
      await settings.update({ merchantId }, { callbackUrl: null });
    }
  });

  it('retries with a backoff, keeps the answer, and holds the next event of the deal back until then', async () => {
    const id = await payIn(HOOK);

    await e2e.http
      .post(`/v1/payment/${id}/extend-timer`)
      .set('X-Secure-Key', key)
      .expect(200);
    await decline(id);

    const [first, second] = await rows(id);
    expect([first.event, second.event]).toEqual([
      'timer_extended',
      'status_changed',
    ]);
    expect([first.eventSeq, second.eventSeq]).toEqual([1, 2]);

    post.mockReset();
    post.mockImplementation(async () => ({ statusCode: 500, body: 'boom' }));
    await send();

    expect(post).toHaveBeenCalledTimes(1);
    expect(JSON.parse(post.mock.calls[0][1] as string).eventSeq).toBe(1);

    const failed = (await rows(id))[0];
    expect(failed).toMatchObject({
      status: 'retrying',
      attempts: 1,
      lastResponseCode: 500,
      lastResponseBody: 'boom',
    });

    await send(30_000);
    expect(post).toHaveBeenCalledTimes(1);

    post.mockImplementation(async () => {
      throw new Error('timeout');
    });
    await send(MINUTE + 1000);
    expect(post).toHaveBeenCalledTimes(2);
    expect((await rows(id))[0].lastError).toBe('timeout');

    answer(200);
    await send(4 * MINUTE);
    const [done, next] = await rows(id);
    expect(done.status).toBe('delivered');
    expect(next.status).toBe('delivered');
    expect(
      post.mock.calls
        .slice(2)
        .map(([, body]) => JSON.parse(body as string).eventSeq),
    ).toEqual([1, 2]);
  });

  it('gives up after the last attempt, and a failed event no longer holds the next one', async () => {
    const id = await payIn(HOOK);

    await e2e.http
      .post(`/v1/payment/${id}/extend-timer`)
      .set('X-Secure-Key', key)
      .expect(200);

    const [row] = await rows(id);
    await e2e.dataSource
      .getRepository(MerchantCallback)
      .update(row.id, { attempts: 9 });
    post.mockImplementation(async () => ({ statusCode: 503, body: '' }));
    await send();

    expect((await rows(id))[0]).toMatchObject({
      status: 'failed',
      attempts: 10,
    });

    await decline(id);
    answer(200);
    await send();
    expect((await rows(id))[1].status).toBe('delivered');
  });

  it('a refused address fails at once, with no retries', async () => {
    const id = await payIn(HOOK);

    await confirm(id);
    post.mockImplementation(async () => {
      throw new CallbackUrlRefusedError('The callback address is not public');
    });
    await send();

    expect((await rows(id))[0]).toMatchObject({
      status: 'failed',
      attempts: 1,
      lastError: 'The callback address is not public',
    });
    await send(10 * 60 * MINUTE);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('a rolled-back change leaves no callback', async () => {
    const id = await payIn(HOOK);

    await e2e.dataSource
      .getRepository(Wallet)
      .update({ userId: trader.user.id }, { mainBalance: toCrypto(0) });

    try {
      await e2e.http
        .post(`/trader/deals/${id}/confirm-changed`)
        .set(bearer(trader))
        .send({ amount: '4000' })
        .expect(409);
      expect(await rows(id)).toEqual([]);
    } finally {
      await e2e.dataSource
        .getRepository(Wallet)
        .update({ userId: trader.user.id }, { mainBalance: toCrypto(100000) });
      await decline(id);
    }
  });

  it('the cabinet lists them for its own merchant; only the merchant account and an admin can resend, once a minute', async () => {
    const id = await payIn(HOOK);

    await confirm(id);

    const [pending] = await rows(id);
    await e2e.http
      .post(`/merchant/callbacks/${pending.id}/resend`)
      .set(bearer(merchant))
      .expect(409);

    await send();

    const listed = await e2e.http
      .get('/merchant/callbacks')
      .set(bearer(support))
      .query({ search: id, status: 'delivered' })
      .expect(200);
    expect(listed.body.data).toEqual([
      expect.objectContaining({
        dealId: id,
        event: 'status_changed',
        dealStatus: 'success',
        amount: '2000.00',
        currency: 'RUB',
        attempts: 1,
        lastResponseCode: 200,
        response: 'ok',
      }),
    ]);

    await e2e.http
      .post(`/merchant/callbacks/${pending.id}/resend`)
      .set(bearer(support))
      .expect(403);

    const stranger = await e2e.createUser(Role.Merchant, {
      merchantId: (await e2e.app.get(MerchantsService).create('Other')).id,
    });
    await e2e.http
      .post(`/merchant/callbacks/${pending.id}/resend`)
      .set(bearer(stranger))
      .expect(404);
    const foreign = await e2e.http
      .get('/merchant/callbacks')
      .set(bearer(stranger))
      .expect(200);
    expect(foreign.body.data).toEqual([]);

    const resent = await e2e.http
      .post(`/merchant/callbacks/${pending.id}/resend`)
      .set(bearer(merchant))
      .expect(200);
    expect(resent.body.data).toMatchObject({
      status: 'pending',
      eventId: pending.eventId,
      eventSeq: pending.eventSeq,
      resendOfId: pending.id,
    });
    await e2e.http
      .post(`/admin/merchant-callbacks/${pending.id}/resend`)
      .set(bearer(admin))
      .expect(409);

    post.mockClear();
    await send();
    expect(post).toHaveBeenCalledTimes(1);
    expect(
      (post.mock.calls[0][2] as Record<string, string>)['X-Event-Id'],
    ).toBe(pending.eventId);

    const ofDeal = await e2e.http
      .get(`/admin/transactions/${id}/callbacks`)
      .set(bearer(admin))
      .expect(200);
    expect(ofDeal.body.data).toHaveLength(2);
  });

  it('no active key: failed with the reason', async () => {
    const lonely = e2e.app.get(MerchantsService);
    const spy = jest
      .spyOn(lonely, 'newestActiveKey')
      .mockResolvedValueOnce(null);
    const id = await payIn(HOOK);

    await confirm(id);
    await send();
    spy.mockRestore();

    expect((await rows(id))[0]).toMatchObject({
      status: 'failed',
      lastError: 'The merchant has no active API key to sign with',
    });
    expect(post).not.toHaveBeenCalled();
  });

  it('two resends survive the original’s removal, retention keeps what is unsent, and the sequence goes on after it', async () => {
    const id = await payIn(HOOK);
    const repository = e2e.dataSource.getRepository(MerchantCallback);

    await e2e.http
      .post(`/v1/payment/${id}/extend-timer`)
      .set('X-Secure-Key', key)
      .expect(200);
    await send();

    const [original] = await rows(id);
    const later = new Date(Date.now() + 91 * 24 * 60 * MINUTE);

    await e2e.http
      .post(`/admin/merchant-callbacks/${original.id}/resend`)
      .set(bearer(admin))
      .expect(200);
    await send();
    await e2e.dataSource.query(
      `UPDATE merchant_callbacks SET "createdAt" = now() - interval '2 minutes' WHERE "resendOfId" = $1`,
      [original.id],
    );
    await e2e.http
      .post(`/admin/merchant-callbacks/${original.id}/resend`)
      .set(bearer(admin))
      .expect(200);
    await send();
    await e2e.dataSource.query(
      `UPDATE merchant_callbacks SET "createdAt" = now() + interval '30 days' WHERE "resendOfId" = $1`,
      [original.id],
    );
    await e2e.dataSource.query(
      `UPDATE merchant_callbacks SET "createdAt" = now() - interval '91 days' WHERE id = $1`,
      [original.id],
    );

    const sender = e2e.app.get(MerchantCallbackSenderService);

    await expect(sender.removeExpired()).resolves.toBeGreaterThanOrEqual(1);
    const left = await rows(id);
    expect(left).toHaveLength(2);
    expect(left.every((row) => row.isResend)).toBe(true);

    await decline(id);
    const after = await rows(id);
    expect(Math.max(...after.map((row) => row.eventSeq))).toBe(2);

    const stuck = after.find((row) => row.eventSeq === 2) as MerchantCallback;
    await repository.update(stuck.id, {
      status: MerchantCallbackStatus.Retrying,
      nextAttemptAt: later,
    });
    await e2e.dataSource.query(
      `UPDATE merchant_callbacks SET "createdAt" = now() - interval '91 days' WHERE id = $1`,
      [stuck.id],
    );
    await sender.removeExpired();
    expect(await repository.findOneBy({ id: stuck.id })).not.toBeNull();
    await repository.update(stuck.id, {
      status: MerchantCallbackStatus.Delivered,
    });
  });

  it('a NUL in the answer is dropped so the result can be saved, and the row reaches its status', async () => {
    const id = await payIn(HOOK);

    await confirm(id);
    post.mockImplementation(async () => ({
      statusCode: 200,
      body: 'a\u0000b',
    }));
    await send();

    expect((await rows(id))[0]).toMatchObject({
      status: 'delivered',
      lastResponseBody: 'ab',
    });
  });

  it('a stale sender cannot overwrite a newer result, and a row out of attempts after crashes is failed without sending', async () => {
    const id = await payIn(HOOK);

    await confirm(id);

    const [row] = await rows(id);
    const repository = e2e.dataSource.getRepository(MerchantCallback);

    post.mockImplementation(async () => {
      await repository.update(row.id, {
        status: MerchantCallbackStatus.Delivered,
        attempts: 5,
      });

      return { statusCode: 500, body: 'late' };
    });
    await send();
    expect((await rows(id))[0]).toMatchObject({
      status: 'delivered',
      attempts: 5,
    });

    const crashed = await payIn(HOOK);
    await confirm(crashed);
    const [spent] = await rows(crashed);

    await repository.update(spent.id, { attempts: 10 });
    post.mockClear();
    await send();
    expect(post).not.toHaveBeenCalled();
    expect((await rows(crashed))[0].status).toBe('failed');
  });

  it('the cabinet hides network detail that an admin sees; a resend waits while another is open', async () => {
    const id = await payIn(HOOK);

    await confirm(id);
    post.mockImplementation(async () => {
      throw new CallbackUrlRefusedError(
        'The callback address 172.18.0.3 is not public',
      );
    });
    await send();

    const [row] = await rows(id);
    const cabinet = await e2e.http
      .get('/merchant/callbacks')
      .set(bearer(merchant))
      .query({ search: id })
      .expect(200);
    expect(cabinet.body.data[0].lastError).toBe(
      'The callback address was refused',
    );
    const forAdmin = await e2e.http
      .get(`/admin/transactions/${id}/callbacks`)
      .set(bearer(admin))
      .expect(200);
    expect(forAdmin.body.data[0].lastError).toContain('172.18.0.3');

    await e2e.http
      .post(`/admin/merchant-callbacks/${row.id}/resend`)
      .set(bearer(admin))
      .expect(200);
    await e2e.dataSource.query(
      `UPDATE merchant_callbacks SET "createdAt" = now() - interval '2 minutes' WHERE "resendOfId" = $1`,
      [row.id],
    );
    await e2e.http
      .post(`/admin/merchant-callbacks/${row.id}/resend`)
      .set(bearer(admin))
      .expect(409);
  });

  it('retention removes what is older than the limit', async () => {
    const id = await payIn(HOOK);

    await confirm(id);
    await send();

    const sender = e2e.app.get(MerchantCallbackSenderService);

    await sender.removeExpired(new Date(Date.now() + 89 * 24 * 60 * MINUTE));
    expect(await rows(id)).toHaveLength(1);
    await sender.removeExpired(new Date(Date.now() + 91 * 24 * 60 * MINUTE));
    expect(await rows(id)).toEqual([]);
  });
});
